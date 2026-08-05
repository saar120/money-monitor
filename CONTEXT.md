# Money Monitor

Money Monitor is a private financial workspace whose authoritative data and calculations live on the paired Mac while client experiences can present that information on other devices.

## Language

**Saved View**:
A read-only presentation of the last accepted financial snapshot when the iPhone cannot use a live Mac connection.
_Avoid_: Offline mode, cached mode

**Stale Saved View**:
A Saved View whose age is significant enough that current balances and conclusions require an explicit warning.
_Avoid_: Expired data, broken sync

**Partial Snapshot**:
An accepted financial snapshot in which specifically identified source values are unavailable while the remaining values are usable.
_Avoid_: Offline snapshot, failed snapshot

**Revoked Pairing**:
A pairing that the authoritative Mac has explicitly invalidated, ending the iPhone's right to retain or display Money Monitor data.
_Avoid_: Offline pairing, disconnected device

**Mutation Conflict**:
A rejected change whose target was updated by another client after the editing client loaded it.
_Avoid_: Mac conflict, sync failure
