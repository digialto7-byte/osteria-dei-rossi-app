/**
 * 4 MiB. A Vercel Function rejects request bodies over 4.5 MB, so this plus the multipart
 * overhead must stay below it. Pinned to the bucket's file_size_limit in the migration. Lives in
 * src/lib because the upload screen uses it too; server modules stay out of the browser bundle.
 */
export const MAX_UPLOAD_BYTES = 4_194_304;
