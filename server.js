const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('uploads/ongoing')) fs.mkdirSync('uploads/ongoing');

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS likes (count INTEGER)");
  db.run("CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS podcast (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, title TEXT, description TEXT, include INTEGER)");

  db.get("SELECT count(*) as total FROM likes", (err, row) => {
    if (row.total === 0) db.run("INSERT INTO likes (count) VALUES (0)");
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/ongoing'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage });

// Likes
app.get('/likes', (req, res) => {
  db.get("SELECT count FROM likes", (err, row) => {
    res.json({ count: row.count });
  });
});

app.post('/like', (req, res) => {
  db.run("UPDATE likes SET count = count + 1", () => {
    db.get("SELECT count FROM likes", (err, row) => {
      res.json({ count: row.count });
    });
  });
});

// Comments
app.get('/comments', (req, res) => {
  db.all("SELECT * FROM comments ORDER BY id DESC", (err, rows) => {
    res.json(rows);
  });
});

app.post('/comment', (req, res) => {
  db.run("INSERT INTO comments (content) VALUES (?)", [req.body.content], () => {
    res.json({ success: true });
  });
});

// Upload
app.post('/upload', upload.single('media'), (req, res) => {
  res.json({ file: `/uploads/ongoing/${req.file.filename}` });
});

// Trim Media (requires FFmpeg installed on host)
app.post('/trim', (req, res) => {
  const { filename, start, duration } = req.body;
  const inputPath = path.join(__dirname, 'uploads/ongoing', filename);
  const outputName = 'trimmed-' + Date.now() + '-' + filename;
  const outputPath = path.join(__dirname, 'uploads/ongoing', outputName);

  const command = `ffmpeg -i "${inputPath}" -ss ${start} -t ${duration} -c copy "${outputPath}"`;

  exec(command, (err) => {
    if (err) return res.status(500).json({ error: "Trimming failed" });
    res.json({ trimmed: `/uploads/ongoing/${outputName}` });
  });
});

// Podcast
app.post('/podcast/add', (req, res) => {
  const { filename, title, description } = req.body;
  db.run("INSERT INTO podcast (filename, title, description, include) VALUES (?, ?, ?, 0)",
    [filename, title, description],
    () => res.json({ success: true })
  );
});

app.post('/podcast/include', (req, res) => {
  const { id, include } = req.body;
  db.run("UPDATE podcast SET include = ? WHERE id = ?", [include, id],
    () => res.json({ success: true })
  );
});

app.get('/podcast', (req, res) => {
  db.all("SELECT * FROM podcast WHERE include = 1", (err, rows) => {
    res.set('Content-Type', 'application/rss+xml');
    let rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
<title>Divine Echo Podcast</title>
<link>http://localhost:${PORT}</link>
<description>I Have a Story and I Want to Tell It</description>`;

    rows.forEach(item => {
      rss += `
<item>
<title>${item.title}</title>
<description>${item.description}</description>
<enclosure url="http://localhost:${PORT}/uploads/ongoing/${item.filename}" type="audio/mpeg" />
</item>`;
    });

    rss += `
</channel>
</rss>`;

    res.send(rss);
  });
});

app.listen(PORT, () => {
  console.log(`Divine Echo running on port ${PORT}`);
});

