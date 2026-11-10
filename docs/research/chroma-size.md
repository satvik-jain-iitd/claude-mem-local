# Chroma folder size: live vs copy (issue #10)

Date: 2026-11-10. Read-only measurements. Nothing was written to the live `~/.claude-mem` or to the copy.

## Short answer

The copy has no `chroma.sqlite3` file. The live folder has one, and it is 777 MB. That file is the whole gap.

## Numbers

| Item | Live `~/.claude-mem/chroma` | Copy `m1/claude-mem-copy/chroma` |
|---|---|---|
| `du -sh` (disk) | 1.1G (1133312 KB) | 355M (363456 KB) |
| Logical bytes (sum of `stat` sizes) | 1,150,645,663 B (1097.3 MiB) | 372,160,531 B (354.9 MiB) |
| Files | 8 | 7 |
| Directories | 2 | 2 |
| Hard-linked files (`-links +1`) | 0 | 0 |
| Symlinks | 0 | 0 |
| `chroma.sqlite3` | 776,777,728 B, mtime 2026-11-10 11:44 | absent |
| HNSW `data_level0.bin` | 359,810,384 B | 358,144,440 B |
| `-wal` / `-shm` files for chroma | none | none |

Per-file, live vs copy (the HNSW files match closely):

- `data_level0.bin`: 359,810,384 (live, 11:02) vs 358,144,440 (copy, 10:46). Live is 1.67 MB bigger, so it grew after the copy.
- `index_metadata.pickle`: 11,358,586 vs 11,305,262.
- `link_lists.bin`: 1,864,116 vs 1,855,380.
- `length.bin`: 858,736 vs 854,760.
- `header.bin`: 100 vs 100.
- `.claude-mem-chroma-store.json` and `.claude-mem-chroma-writer.lock`: 300 and 289 bytes, same on both sides.

Sum of the copy files: 372 MB decimal, which is the "366M" from the first scan (it is 355 MiB, the same bytes).

## Checks

- **Hard links:** none on either side. Verified (`find -links +1` returns 0).
- **Sparse files:** none. Live `chroma.sqlite3` allocates 781,328,384 B for 776,843,264 B logical (block overhead only). Live `data_level0.bin` allocates 364,568,576 B for 359,810,384 B logical. Verified.
- **Files still being written:** the live `chroma.sqlite3` and HNSW files changed after the copy (`find -newer` lists them). The live writer lock (pid 49597, bun) was acquired 2026-11-10 04:25 UTC and the store was updated 04:25 UTC. The live writer is active. Verified. Growth since the copy is about 1.7 MB in the HNSW file, which is small next to the 777 MB gap. Verified.
- **WAL/shm:** no chroma WAL or shm file exists in either folder. The `claude-mem.db-wal` and `-shm` files belong to the main SQLite db, not to chroma. Verified.
- **Was the sqlite file created after the copy?** No. Its birth time is 2026-10-07 07:35:28. It existed long before the copy at 10:46. Verified.
- **Did the copy skip it?** Yes, the file is absent from the copy. The top-level `claude-mem.db` did copy (330 MB in the copy vs 333 MB live, the difference is growth). So the copy kept other large files. The exact cause is unknown. Guess: the copy command used a pattern that dropped `*.sqlite3` in chroma, or it copied only the `.bin` and `.pickle` files. The brief says no `--exclude` was used, but the copy's own command log was not found in the scratchpad, so this is not verified.

## Conclusion

- Verified: the 1.1G live number and the 366M copy number are both correct. They measure different sets of files.
- Verified: the `chroma.sqlite3` file (740.9 MiB) is the difference. Live logical 1097.3 MiB minus copy logical 354.9 MiB is 742.4 MiB. The 1.5 MiB left over is HNSW growth and file metadata.
- Verified: the copy is missing `chroma.sqlite3`. The copy is not a full copy of the chroma folder.
- Guess: the copy step filtered out `*.sqlite3`. Not verified.

## Next measurement

1. Find the copy command. Check the shell history or the step that built `m1/claude-mem-copy`, and look for a filter on `*.sqlite3` or `chroma/*`.
2. Re-copy only `chroma/chroma.sqlite3` to a new folder in the scratchpad (read-only from the live side, e.g. `cp -p`), then compare its size and `sqlite3 ... 'PRAGMA integrity_check'` on the copy. Do not open the live file in write mode.
3. Check what is inside `chroma.sqlite3` (table row counts with `sqlite3` on the copy) to see whether the 777 MB holds embeddings or only metadata. This decides whether the copy needs it for the test.
4. Re-run the size check after the copy finishes, to confirm the new total is about 1.1G.
