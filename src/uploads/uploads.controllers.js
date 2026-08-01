import { createUploadUrl } from './uploads.services.js';

export const signUpload = async (req, res) => {
    const upload = await createUploadUrl(req.user, req.body);
    return res.status(201).json(upload);
}
