import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { s3, BUCKET } from "../lib/s3.js";
import { logger } from "../lib/logger.js";
import { withServiceError } from "../lib/withServiceError.js";
import { withTransaction } from "../../database/connection.js";
import { claimPendingDeletions, removeDeletionRows, markDeletionFailed } from "./uploads.queries.js";

// Los services de otros dominios encolan por aca, para no importar el archivo de queries.
export { enqueueDeletions } from './uploads.queries.js';

const log = logger.child({ module: 'uploads' });

const MB = 1024 * 1024;

/** Tipo MIME -> extension. La clave del grupo es el "kind" del contenido. */
const CONTENT_KINDS = {
    IMAGE: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
    VIDEO: { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
};

const MAX_BYTES = { IMAGE: 10 * MB, VIDEO: 200 * MB };

// TTL de la URL de lectura. El video pide mas margen: 200 MB por una conexion lenta
// pueden tardar mas que una URL corta y romper la reproduccion a mitad.
const READ_TTL = { IMAGE: 3600, VIDEO: 6 * 3600 };

const UPLOAD_TTL = 300;

/** Cada destino declara que tipos admite. Agregar uno nuevo es una linea. */
export const UPLOAD_SCOPES = {
    "route-cover": ["IMAGE"],
    "lesson-block": ["IMAGE", "VIDEO"],
    "quiz-question": ["IMAGE"],
    "avatar": ["IMAGE"],
};

/** Tope de keys que admite DeleteObjectsCommand en una sola llamada. */
const DELETE_BATCH = 1000;

/**
 * Distingue una key nuestra de un enlace externo. Las columnas de adjuntos son mixtas:
 * users.image puede traer la URL de Google, y un lesson_blocks.url puede ser un video
 * de YouTube pegado por el usuario. A esos no hay que firmarlos ni intentar borrarlos.
 */
export const isStorageKey = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith('http');

/**
 * Keys que dejaron de estar referenciadas tras un reemplazo. Es una diferencia de
 * conjuntos y no "todas las viejas" a proposito: en un PUT el usuario suele conservar
 * parte de los adjuntos, y encolar esos borraria de S3 un objeto que la fila sigue
 * apuntando. Filtra ademas los enlaces externos, que nunca deben llegar a DeleteObjects.
 */
export const orphanKeys = (previous = [], next = []) => {
    const kept = new Set(next.filter(isStorageKey));
    return [...new Set(previous.filter((key) => isStorageKey(key) && !kept.has(key)))];
}

const kindOf = (contentType) =>
    Object.keys(CONTENT_KINDS).find((kind) => contentType in CONTENT_KINDS[kind]) ?? null;

const prefixFor = (scope, userId) => `uploads/${scope}/${userId}/`;

/** La key lleva dentro el scope y el dueño, asi que el prefijo alcanza para autorizar. */
const assertOwnedKey = (user, key, scope) => {
    if (typeof key !== 'string' || !key.startsWith(prefixFor(scope, user.userId))) {
        log.warn({ userId: user.userId, scope, key }, 'upload.forbidden_key');
        throw { code: 'ACCESS_DENIED', message: 'El archivo no te pertenece' };
    }
};

export const createUploadUrl = withServiceError(async (user, { scope, contentType, size }) => {
    const allowedKinds = UPLOAD_SCOPES[scope];
    if (!allowedKinds) {
        log.warn({ userId: user.userId, scope, reason: 'scope_invalido' }, 'upload.rejected');
        throw { code: 'UPLOAD_SCOPE_INVALID', message: 'El destino de la subida no es valido' };
    }

    const kind = kindOf(contentType);
    if (!kind || !allowedKinds.includes(kind)) {
        log.warn({ userId: user.userId, scope, contentType, reason: 'tipo_no_permitido' }, 'upload.rejected');
        throw { code: 'UPLOAD_TYPE_NOT_ALLOWED', message: `El tipo ${contentType} no se admite en ${scope}` };
    }

    const maxBytes = MAX_BYTES[kind];
    if (size > maxBytes) {
        log.warn({ userId: user.userId, scope, contentType, size, reason: 'demasiado_grande' }, 'upload.rejected');
        throw { code: 'UPLOAD_TOO_LARGE', message: `El archivo supera el maximo de ${maxBytes / MB} MB` };
    }

    const key = `${prefixFor(scope, user.userId)}${randomUUID()}.${CONTENT_KINDS[kind][contentType]}`;

    // ContentLength queda firmado: si el cliente sube otra cantidad de bytes, S3 rechaza el PUT.
    const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, ContentLength: size }),
        { expiresIn: UPLOAD_TTL }
    );

    // Nunca se loguea `url`: lleva X-Amz-Signature, que es permiso de escritura sobre el bucket.
    log.info({ userId: user.userId, scope, kind, key, contentType, size }, 'upload.presigned');

    return { url, key, expiresIn: UPLOAD_TTL };
}, { code: 'ERROR_CREATING_UPLOAD_URL', message: 'Hubo un error al intentar preparar la subida' });

/**
 * Se llama antes de guardar la key en la base. El tamaño ya lo impone S3 al firmar,
 * asi que aca lo que importa es que la key sea del usuario y que el objeto exista de verdad.
 */
export const verifyUpload = withServiceError(async (user, key, scope) => {
    assertOwnedKey(user, key, scope);

    let head;
    try {
        head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    }
    catch (error) {
        if (error.$metadata?.httpStatusCode === 404) {
            log.warn({ userId: user.userId, key }, 'upload.not_found');
            throw { code: 'UPLOAD_NOT_FOUND', message: 'El archivo no se encuentra, vuelve a subirlo' };
        }
        throw error;
    }

    log.info({ userId: user.userId, key, size: head.ContentLength, contentType: head.ContentType }, 'upload.verified');

    return { size: head.ContentLength, contentType: head.ContentType };
}, { code: 'ERROR_VERIFYING_UPLOAD', message: 'Hubo un error al intentar verificar el archivo' });

/** Convierte la key guardada en la base en una URL que el cliente pueda abrir. */
export const urlOfReading = withServiceError(async (key, kind = 'IMAGE') => {
    if (!key) return null;

    // Un enlace externo (p. ej. la foto de Google) se devuelve tal cual, sin firmar.
    if (!isStorageKey(key)) return key;

    const ttl = READ_TTL[kind] ?? READ_TTL.IMAGE;

    // Redondear la fecha de firma hace que la misma key devuelva la misma URL dentro de la
    // ventana, para que el navegador la cachee en vez de re-descargar en cada request.
    // La ventana es medio TTL, asi que a la URL siempre le queda al menos la mitad de vida.
    const windowMs = (ttl / 2) * 1000;
    const signingDate = new Date(Math.floor(Date.now() / windowMs) * windowMs);

    return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttl, signingDate });
}, { code: 'ERROR_READING_UPLOAD', message: 'Hubo un error al intentar obtener el archivo' });

/**
 * Drena la cola de borrados contra S3. No se llama al borrar: el borrado se limita a
 * encolar dentro de la transaccion, y esto se encarga de bajarlo al bucket despues.
 *
 * Todo va dentro de una transaccion para que los locks del SKIP LOCKED duren hasta que
 * S3 confirme; si el proceso muere a la mitad, el ROLLBACK libera las keys y otro las toma.
 */
export const drainPendingDeletions = async () => withTransaction(async (client) => {
    const pending = await claimPendingDeletions(client, DELETE_BATCH);
    if (pending.length === 0) return { deleted: 0, failed: 0 };

    const byKey = new Map(pending.map((row) => [row.key, row.id]));

    const result = await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: pending.map((row) => ({ Key: row.key })), Quiet: false },
    }));

    // S3 es idempotente en el delete: una key que ya no existe vuelve en Deleted, no en
    // Errors. Asi un reintento tras una caida a medias no se queda atascado para siempre.
    const okIds = (result.Deleted ?? []).map((entry) => byKey.get(entry.Key)).filter(Boolean);
    const failed = result.Errors ?? [];
    const failedIds = failed.map((entry) => byKey.get(entry.Key)).filter(Boolean);

    await removeDeletionRows(client, okIds);
    if (failedIds.length > 0) {
        await markDeletionFailed(client, failedIds, failed[0].Message ?? failed[0].Code ?? 'error desconocido');
        log.warn({ failed: failed.map((e) => ({ key: e.Key, code: e.Code })) }, 'deletion.failed');
    }

    log.info({ deleted: okIds.length, failed: failedIds.length }, 'deletion.drained');

    return { deleted: okIds.length, failed: failedIds.length };
});
