// HD-028..032, HD-069/078/089/095: bounded local NPC snapshot continuity.
// This is an operator-owned store, not account authentication or a population database.
using System;
using System.IO;
using System.Linq;
using Dark.Core;

namespace Dark.Population
{
    public sealed class InhabitantPersistenceResult
    {
        internal InhabitantPersistenceResult(bool succeeded, string code, Inhabitant state, long generation = 0, string digest = "")
        { Succeeded = succeeded; Code = code; State = state; Generation = generation; Digest = digest; }
        public bool Succeeded { get; }
        public string Code { get; }
        /// <summary>Original live instance on every refusal. A successful restore returns a validated replacement.</summary>
        public Inhabitant State { get; }
        public long Generation { get; }
        /// <summary>Receipt to retain in a separately trusted checkpoint, not just beside the replaceable file.</summary>
        public string Digest { get; }
    }

    public sealed class FileInhabitantStore
    {
        public const string Genesis = "0000000000000000000000000000000000000000000000000000000000000000";
        public const int MaximumFileBytes = 256 * 1024;
        public string Path { get; }
        public string ExpectedActorId { get; }
        public FileInhabitantStore(string path, string expectedActorId)
        {
            Path = System.IO.Path.GetFullPath(path);
            ExpectedActorId = Canonical.RequireId(expectedActorId, nameof(expectedActorId));
        }
        InhabitantPersistenceResult Refuse(Inhabitant current, string code) => new InhabitantPersistenceResult(false, code, current);
        string? InputRefusal(Inhabitant current, string digest)
        {
            if (current == null) throw new ArgumentNullException(nameof(current));
            if (current.Id != ExpectedActorId) return "identity_mismatch";
            return digest == null || digest.Length != 64 || digest.Any(c => !(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) ? "invalid_digest" : null;
        }
        /// <summary>Caller must quiesce the actor while capturing its snapshot. Saving never changes the actor.</summary>
        public InhabitantPersistenceResult Save(Inhabitant current, string expectedPreviousDigest)
        {
            string? refusal = InputRefusal(current, expectedPreviousDigest);
            if (refusal != null) return Refuse(current, refusal);
            string? temporary = null;
            try
            {
                var snapshot = current.Snapshot();
                // Validate before creating the cooperative lock file or changing any snapshot bytes.
                InhabitantSnapshotCodec.Validate(snapshot);
                using (var writerLock = new FileStream(Path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                {
                    bool exists = File.Exists(Path);
                    StoredInhabitantSnapshot? previous = exists ? Read() : null;
                    string actualPrevious = previous?.Digest ?? Genesis;
                    if (actualPrevious != expectedPreviousDigest) return Refuse(current, "stale_snapshot");
                    if (previous?.Generation == long.MaxValue) return Refuse(current, "generation_exhausted");
                    long generation = previous == null ? 1 : previous.Generation + 1;
                    byte[] bytes = InhabitantSnapshotCodec.Encode(snapshot, generation);
                    string digest = InhabitantSnapshotCodec.Receipt(bytes);
                    // Same-directory creation and replacement; random filename has no role in snapshot semantics.
                    temporary = Path + ".tmp-" + Guid.NewGuid().ToString("N");
                    using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                    if (exists) File.Replace(temporary, Path, null); else File.Move(temporary, Path);
                    temporary = null;
                    return new InhabitantPersistenceResult(true, "saved", current, generation, digest);
                }
            }
            catch (SnapshotException e) { return Refuse(current, e.Code); }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is NotSupportedException)
            { return Refuse(current, "storage_failed"); }
            finally
            {
                // Best-effort cleanup never replaces the original refusal. The stable lock file is retained.
                if (temporary != null)
                    try { File.Delete(temporary); }
                    catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { }
            }
        }
        /// <summary>Read-only discovery/restore; never creates files, repairs corruption, or invents a seed.</summary>
        public InhabitantPersistenceResult Restore(Inhabitant current, string trustedDigest)
        {
            string? refusal = InputRefusal(current, trustedDigest);
            if (refusal != null) return Refuse(current, refusal);
            try
            {
                var stored = Read();
                if (stored.Digest != trustedDigest) return Refuse(current, "digest_mismatch");
                var restored = Inhabitant.Restore(stored.Snapshot);
                return new InhabitantPersistenceResult(true, "restored", restored, stored.Generation, stored.Digest);
            }
            catch (FileNotFoundException) { return Refuse(current, "missing_snapshot"); }
            catch (DirectoryNotFoundException) { return Refuse(current, "missing_snapshot"); }
            catch (SnapshotException e) { return Refuse(current, e.Code); }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is NotSupportedException)
            { return Refuse(current, "storage_failed"); }
        }
        StoredInhabitantSnapshot Read()
        {
            using (var stream = new FileStream(Path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
            {
                long length = stream.Length; // Capture once so a racing external grow cannot bypass the allocation bound.
                if (length > MaximumFileBytes) throw new SnapshotException("snapshot_too_large");
                var bytes = new byte[(int)length]; int offset = 0;
                while (offset < bytes.Length)
                {
                    int read = stream.Read(bytes, offset, bytes.Length - offset);
                    if (read == 0) throw new SnapshotException("invalid_snapshot");
                    offset += read;
                }
                if (stream.ReadByte() != -1) throw new SnapshotException("invalid_snapshot");
                return InhabitantSnapshotCodec.Decode(bytes, ExpectedActorId);
            }
        }
    }
}
