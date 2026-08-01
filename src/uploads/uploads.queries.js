/**
 * Todas estas funciones reciben el `client` de una transaccion en curso en vez del pool.
 * Eso es lo que hace que encolar una key sea atomico con el DELETE que la dejo huerfana.
 */


export const enqueueDeletions = async (client, keys) => {
    if (keys.length === 0) return 0;
    const { rowCount } = await client.query(
        `INSERT INTO pending_deletions (key)
            SELECT unnest($1::text[])
            ON CONFLICT (key) DO NOTHING`,
        [keys]
    );
    
    return rowCount;
}

/**
 * SKIP LOCKED deja que varias instancias del server drenen la cola a la vez sin
 * pisarse: cada una se lleva un lote distinto en vez de bloquearse esperando.
 */
export const claimPendingDeletions = async (client, limit) => {
    const { rows } = await client.query(
        `SELECT id, key FROM pending_deletions
            WHERE attempts < 5
            ORDER BY created_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED`,
        [limit]
    );
    
    return rows;
}

export const removeDeletionRows = async (client, ids) => {
    if (ids.length === 0) return 0;
    
    const { rowCount } = await client.query(
        `DELETE FROM pending_deletions WHERE id = ANY($1::bigint[])`,
        [ids]
    );
    
    return rowCount;
}



export const markDeletionFailed = async (client, ids, message) => {
    if (ids.length === 0) return 0;
    
    const { rowCount } = await client.query(
        `UPDATE pending_deletions
            SET attempts = attempts + 1, last_error = $2
        WHERE id = ANY($1::bigint[])`,
        [ids, message]
    );
    
    return rowCount;
}
