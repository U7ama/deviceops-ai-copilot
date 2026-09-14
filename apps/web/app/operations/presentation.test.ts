import {describe,it,expect} from 'vitest';
import {readLocation,isStale,healthLabel} from './presentation';
describe('operations presentation',()=>{
 it('maps legacy views and preserves actual incident selection',()=>{expect(readLocation('?view=enterprise')).toMatchObject({view:'overview',section:'anomalies'});expect(readLocation('?view=discovery&incident=a')).toMatchObject({view:'admin',incident:'a'});expect(readLocation('?view=invalid').view).toBe('overview');});
 it('uses device cadence and distinguishes stale and absent observations',()=>{expect(isStale({observedAt:new Date(1000).toISOString(),pollIntervalMs:5000},16001)).toBe(true);expect(isStale({observedAt:new Date(1000).toISOString(),pollIntervalMs:10000},16001)).toBe(false);expect(isStale({observedAt:null},1000)).toBe(true);});
 it('does not equate unreachable equipment with an observed fault',()=>{expect(healthLabel('offline')).toBe('Health unavailable — unreachable');expect(healthLabel('online')).toBe('Operational');expect(healthLabel('unexpected')).toBe('Health unknown');});
});
