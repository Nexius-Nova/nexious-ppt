import { removeGroupOpacity } from './server/engine/svgQuality.js';

// Test 1: <g opacity> with other attributes
const input1 = '<g stroke="#B8C5D6" stroke-width="0.5" opacity="0.3"><line x1="0" y1="120" x2="1280" y2="120"/></g>';
const result1 = removeGroupOpacity(input1);
console.log('Test 1 - Input:', input1);
console.log('Test 1 - Output:', result1);
console.log('Test 1 - Has gstroke bug:', result1.includes('gstroke'));
console.log('Test 1 - Has <g space:', result1.includes('<g '));
console.log('');

// Test 2: <g opacity> with id
const input2 = '<g id="group1" opacity="0.5"><rect x="10" y="10" width="100" height="100"/></g>';
const result2 = removeGroupOpacity(input2);
console.log('Test 2 - Input:', input2);
console.log('Test 2 - Output:', result2);
console.log('');

// Test 3: <g opacity="1"> should just remove opacity
const input3 = '<g id="group2" opacity="1"><rect x="10" y="10" width="100" height="100"/></g>';
const result3 = removeGroupOpacity(input3);
console.log('Test 3 - Input:', input3);
console.log('Test 3 - Output:', result3);
console.log('');

// Test 4: nested <g opacity>
const input4 = '<g id="outer" opacity="0.8"><g id="inner" opacity="0.5"><rect x="10" y="10" width="100" height="100"/></g></g>';
const result4 = removeGroupOpacity(input4);
console.log('Test 4 - Input:', input4);
console.log('Test 4 - Output:', result4);
console.log('');

// Test 5: No <g opacity> - should be unchanged
const input5 = '<g id="group3"><rect x="10" y="10" width="100" height="100"/></g>';
const result5 = removeGroupOpacity(input5);
console.log('Test 5 - Input:', input5);
console.log('Test 5 - Output:', result5);
console.log('Test 5 - Unchanged:', input5 === result5);
