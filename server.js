// Entry file. On Hostinger set "Entry file" to server.js. The web server starts right away;
// the database connects in the background and the app shows a clear message until it does.
const {app} = require('./server/index.js');
const port = +process.env.PORT || 3000;
app.listen(port, () => console.log(`DetailDesk running on port ${port}`));
