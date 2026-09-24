import { z } from 'zod';

/** Declarations shared by more than one hq feature. */

export const futureDate = z.coerce.date().optional().nullable();
