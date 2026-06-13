import { removeGroupOpacity } from './server/engine/svgQuality.js';

// Test: <g id="x" opacity="0.5"> - opacity at end with id before
const r1 = removeGroupOpacity('<g id="x" opacity="0.5"><rect/></g>');
console.log('Test id+opacity:', r1);

// Test: <g opacity="0.5" id="x"> - opacity at start with id after
const r2 = removeGroupOpacity('<g opacity="0.5" id="x"><rect/></g>');
console.log('Test opacity+id:', r2);

// Test: <g opacity="0.5"> - only opacity
const r3 = removeGroupOpacity('<g opacity="0.5"><rect/></g>');
console.log('Test only opacity:', r3);

// Test: <g stroke="#B8C5D6" stroke-width="0.5" opacity="0.3"> - real case
const r4 = removeGroupOpacity('<g stroke="#B8C5D6" stroke-width="0.5" opacity="0.3"><line x1="0" y1="120" x2="1280" y2="120"/></g>');
console.log('Test real case:', r4);
console.log('Has gstroke bug:', r4.includes('gstroke'));
