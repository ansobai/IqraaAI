const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'assets', 'data', 'madani-muhsaf.json');

console.log('Reading file...');
const data = fs.readFileSync(filePath, 'utf8');

console.log('Original length:', data.length);

// Characters to KEEP (legitimate Quranic marks):
// U+06D6 - Arabic Small High Ligature Sad With Lam With Alef Maksura (stop sign)
// U+06D7 - Arabic Small High Ligature Qaf With Lam With Alef Maksura  
// U+06D8 - Arabic Small High Meem Initial Form
// U+06D9 - Arabic Small Low Seen
// U+06DA - Arabic Small High Jeem
// U+06DB - Arabic Small High Three Dots
// U+06DC - Arabic Small High Seen
// U+06DD - Arabic End Of Ayah (verse marker) - KEEP
// U+06DE - Arabic Start Of Rub El Hizb (۞) - KEEP
// U+06E0 - Arabic Small High Upright Rectangular Zero 
// U+06E9 - Arabic Place Of Sajdah - KEEP  
// U+06EA - Arabic Empty Centre Low Stop
// U+06EB - Arabic Empty Centre High Stop
// U+06EC - Arabic Rounded High Stop With Filled Centre 
// U+06ED - Arabic Small Low Meem

// Characters to REMOVE (rendering as circles or incorrectly):
const charsToRemove = [
    '\uFBBF',  // Arabic Ligature issue
    '\u06DF',  // Arabic Small High Rounded Zero (BIG BLACK CIRCLE issue)
    '\u06E2',  // Arabic Small High Meem Isolated Form (BLACK CIRCLE issue)
    '\u06E3',  // Arabic Small Low Seen
    '\u06E4',  // Arabic Small High Madda
    '\u06E5',  // Arabic Small Waw (renders incorrectly)
    '\u06E6',  // Arabic Small Yeh (renders incorrectly)
    '\u06E7',  // Arabic Small High Yeh (renders incorrectly)
    '\u06E8',  // Arabic Small High Noon (renders incorrectly)
];

// Create regex pattern from all chars to remove
const pattern = new RegExp('[' + charsToRemove.join('') + ']', 'g');

const cleaned = data.replace(pattern, '');

console.log('Cleaned length:', cleaned.length);
console.log('Characters removed:', data.length - cleaned.length);

// Show what marks still remain
const remaining = cleaned.match(/[\u06D6-\u06ED]/g);
if (remaining) {
    const unique = [...new Set(remaining)];
    console.log('\nRemaining marks (kept):');
    unique.forEach(c => console.log('  U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')));
}

fs.writeFileSync(filePath, cleaned, 'utf8');
console.log('\nDone! File cleaned successfully.');
