// Version of the client <-> match server wire protocol. Bump it whenever an
// event's shape changes: the server refuses older clients with
// 'update_required', so an installed app that has not updated gets told to
// reload instead of joining a match it would silently misread.
export const PROTOCOL_VERSION = 3;
