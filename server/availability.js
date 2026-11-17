const DAYS = new Set(['周一','周二','周三','周四','周五','周六','周日']);
export function registerAvailability(app, db, auth) {
  db.exec(`CREATE TABLE IF NOT EXISTS availability (user_id INTEGER NOT NULL, day TEXT NOT NULL, start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'window', title TEXT DEFAULT '', PRIMARY KEY(user_id,day,start_minute,end_minute,kind))`);
  app.get('/api/availability', auth, (req,res) => res.json(db.prepare('SELECT * FROM availability WHERE user_id=? ORDER BY day,start_minute').all(req.user.id)));
  app.put('/api/availability', auth, (req,res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length > 100) return res.status(413).json({error:'too many availability rows'});
    const valid = rows.filter(x => DAYS.has(x.day) && ['window','fixed'].includes(x.kind) && Number.isInteger(x.start_minute) && Number.isInteger(x.end_minute) && x.start_minute >= 0 && x.end_minute <= 1440 && x.start_minute < x.end_minute);
    if (valid.length !== rows.length) return res.status(400).json({error:'invalid availability row'});
    const tx = db.transaction(() => { db.prepare('DELETE FROM availability WHERE user_id=?').run(req.user.id); const put=db.prepare('INSERT INTO availability(user_id,day,start_minute,end_minute,kind,title) VALUES(?,?,?,?,?,?)'); valid.forEach(x=>put.run(req.user.id,x.day,x.start_minute,x.end_minute,x.kind,String(x.title||'').slice(0,120))); });
    tx(); res.json({saved:valid.length});
  });
}
