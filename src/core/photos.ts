/** Photo limits shared by the interface and the main process. */

/** Photos handed over in one call; larger selections are sent in several batches. */
export const MAX_IMPORT_BATCH = 30;

/** Photos one day can hold. */
export const MAX_PHOTOS_PER_DAY = 60;

/** Photos the Memories gallery loads at a time. */
export const GALLERY_PAGE_SIZE = 120;

/** The most photos one gallery request may ask for. */
export const MAX_GALLERY_LIMIT = 10_000;
