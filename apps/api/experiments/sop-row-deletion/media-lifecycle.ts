/** The closed experiment keeps its public surface while the implementation now
 * lives in the production intake module. One owner, one copy of the rules. */
export {
  attachmentDescriptor,
  createSopMediaLifecycle,
  decodeSopMediaReservation,
  sopSqlFailure,
  type SopMediaReservation as Reservation,
} from '../../src/content-intake/sop-media.js';
