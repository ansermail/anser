use rusqlite::{params, Connection};
fn main() -> rusqlite::Result<()> {
    let path = std::env::args()
        .nth(1)
        .expect("Pass a new temporary database path; fictional data only");
    assert!(
        !std::path::Path::new(&path).exists(),
        "Experiment database already exists; do not overwrite"
    );
    let mut db = Connection::open(&path)?;
    println!("sqlite={}", rusqlite::version());
    db.execute_batch("PRAGMA journal_mode=WAL;CREATE TABLE text_index(id INTEGER PRIMARY KEY,thread INTEGER,instant INTEGER,subject TEXT,body TEXT);CREATE INDEX time_order ON text_index(instant DESC,id ASC);CREATE VIRTUAL TABLE ft USING fts5(subject,body,content='text_index',content_rowid='id',tokenize='trigram');CREATE TRIGGER ai AFTER INSERT ON text_index BEGIN INSERT INTO ft(rowid,subject,body) VALUES(new.id,new.subject,new.body); END;")?;
    let started = std::time::Instant::now();
    let tx = db.transaction()?;
    {
        let mut insert = tx.prepare("INSERT INTO text_index VALUES(?1,?2,?3,?4,?5)")?;
        for i in 0..50_000 {
            let subject = if i % 1000 == 0 {
                format!("项目预算审核-{i}")
            } else {
                format!("示例通知-{i}")
            };
            let body = format!(
                "{}{}",
                "虚构正文仅用于性能实验。日常项目沟通，不含任何真实邮件。".repeat(15),
                if i % 1000 == 0 {
                    "ABC_100% \"literal\"预算"
                } else {
                    "普通说明"
                }
            );
            insert.execute(params![i, i / 3, 50_000 - i, subject, body])?;
        }
    }
    tx.commit()?;
    println!("insert_50000_ms={}", started.elapsed().as_millis());
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    drop(db);
    for round in ["connection-cold", "hot"] {
        let db = Connection::open(&path)?;
        for needle in [
            "预算审核",
            "预算",
            "预",
            "100%",
            "ABC_",
            "\"literal\"",
            "NOT",
            "不存在的词",
        ] {
            let start = std::time::Instant::now();
            let baseline:i64=db.query_row("SELECT COUNT(*) FROM text_index WHERE instr(lower(subject||' '||body),lower(?1))>0",[needle],|r|r.get(0))?;
            let phrase = format!("\"{}\"", needle.replace('"', "\"\""));
            let count: i64 = if needle.chars().count() >= 3 {
                db.query_row("SELECT COUNT(*) FROM ft JOIN text_index t ON t.id=ft.rowid WHERE ft MATCH ?1 AND instr(lower(t.subject||' '||t.body),lower(?2))>0",params![phrase,needle],|r|r.get(0))?
            } else {
                baseline
            };
            assert_eq!(count, baseline, "FTS loses literal substring");
            println!(
                "{round} needle={needle:?} count={count} comparative_ms={}",
                start.elapsed().as_millis()
            );
        }
        let start = std::time::Instant::now();
        let count: i64 =
            db.query_row("SELECT COUNT(DISTINCT thread) FROM text_index", [], |r| {
                r.get(0)
            })?;
        let mut st=db.prepare("WITH ranked AS (SELECT id,thread,instant,row_number() OVER(PARTITION BY thread ORDER BY instant DESC,id ASC) n FROM text_index) SELECT id FROM ranked WHERE n=1 ORDER BY instant DESC,id ASC LIMIT 200")?;
        let page = st
            .query_map([], |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        assert_eq!(count, 16667);
        assert_eq!(page.len(), 200);
        println!(
            "{round} conversation_count_and_page_ms={}",
            start.elapsed().as_millis()
        );
    }
    Ok(())
}
