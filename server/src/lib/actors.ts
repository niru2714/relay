import { ACTOR_TYPE } from '../domain/constants.js';
import type { Actor } from '../domain/types.js';

export type { Actor };

export const systemActor = (name = 'RELAY automation'): Actor => ({
  type: ACTOR_TYPE.SYSTEM,
  id: 'system',
  name,
});

export const dispatcherActor = (name = 'Dispatcher'): Actor => ({
  type: ACTOR_TYPE.DISPATCHER,
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
});

export const riderActor = (rider: { id: string; name: string }): Actor => ({
  type: ACTOR_TYPE.RIDER,
  id: String(rider.id),
  name: rider.name,
});
