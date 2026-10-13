// All money is stored as integer paise. This only formats for display/CSV.
const rupees = (paise) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
module.exports = { rupees };
