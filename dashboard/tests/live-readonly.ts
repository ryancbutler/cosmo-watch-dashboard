// Explicit opt-in check. Credentials must be passed in the process environment.
import { FilipClient, fetchDashboard } from '../lib/filip.server.ts';
if (!process.env.COSMO_EMAIL || !process.env.COSMO_PASSWORD) throw new Error('Credentials not configured');
const data = await fetchDashboard(new FilipClient(process.env.COSMO_EMAIL, process.env.COSMO_PASSWORD));
console.log(JSON.stringify({ watches: data.watches.length, notificationRecords:data.notifications.length, notificationsState:data.notificationsState, validLocations: data.watches.filter(w=>w.location).length, batteryReadings: data.watches.filter(w=>w.battery !== null).length, stepsStates: data.watches.map(w=>w.stepsState), goalStates: data.watches.map(w=>w.goalState), zonesState:data.zonesState, schedulesState:data.schedulesState }));
