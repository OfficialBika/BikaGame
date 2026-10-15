import { dispatch } from '../lib/mini.js';
export default async function (input, ctx) { return dispatch('blackjackStatus', input, ctx); }
