import { dispatch } from '../lib/mini.js';
export default async function (input, ctx) { return dispatch('walletTransfer', input, ctx); }
