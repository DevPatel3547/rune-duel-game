// Version of the client <-> match server wire protocol. Bump it whenever an
// event's shape changes: the server refuses older clients with
// 'update_required', so an installed app that has not updated gets told to
// reload instead of joining a match it would silently misread.
// v4: trails carry the 2D stroke so far (points2d), which the server checks
// casts against; a v3 client would be scored as never observed.
export const PROTOCOL_VERSION = 4;
