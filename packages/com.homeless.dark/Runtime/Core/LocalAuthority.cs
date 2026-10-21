using System;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace Dark.Core
{
    /// <summary>Deterministic simulation clock owned by the local operator/simulation loop.
    /// Do not expose AdvanceTo through player effect handlers or derive it from proposed event ticks.</summary>
    public sealed class SimulationClock
    {
        internal readonly object Sync = new object();
        long tick;
        public SimulationClock(long initialTick)
        {
            if (initialTick < 0) throw new ArgumentOutOfRangeException(nameof(initialTick));
            tick = initialTick;
        }
        public long Tick { get { lock (Sync) return tick; } }
        public void AdvanceTo(long nextTick)
        {
            lock (Sync)
            {
                if (nextTick < tick) throw new ArgumentOutOfRangeException(nameof(nextTick), "Authoritative simulation time cannot rewind.");
                tick = nextTick;
            }
        }
    }

    public sealed class ActorSession
    {
        internal ActorSession(string actorId, string role, long issuedAt, long expires, HashSet<string> scope)
        { ActorId = actorId; Role = role; IssuedAt = issuedAt; Expires = expires; Scope = scope; }
        public string ActorId { get; }
        public string Role { get; }
        public long IssuedAt { get; }
        public long Expires { get; }
        internal HashSet<string> Scope { get; }
    }

    // Local operator boundary. Registration and clock advancement are NEVER player-facing APIs.
    // Keys are random 256-bit credentials, not passwords. Network auth is not implemented.
    public sealed class LocalAuthority
    {
        sealed class Principal
        {
            public Principal(byte[] keyHash, string role, string[] scopes)
            { KeyHash = keyHash; Role = role; Scopes = scopes; }
            public readonly byte[] KeyHash;
            public readonly string Role;
            public readonly string[] Scopes;
        }
        readonly object sync = new object();
        readonly Dictionary<string, Principal> principals = new Dictionary<string, Principal>(StringComparer.Ordinal);
        readonly HashSet<ActorSession> sessions = new HashSet<ActorSession>();
        readonly string? founderId;
        internal SimulationClock Clock { get; }
        public LocalAuthority(SimulationClock clock)
        { Clock = clock ?? throw new ArgumentNullException(nameof(clock)); }
        public LocalAuthority(SimulationClock clock, string founderId, byte[] founderKey) : this(clock)
        {
            this.founderId = Canonical.RequireId(founderId, nameof(founderId));
            principals.Add(founderId, new Principal(HashKey(founderKey), "founder_dark", Array.Empty<string>()));
        }
        public void RegisterMember(string actorId, byte[] key, params string[] scopes)
        {
            Canonical.RequireId(actorId, nameof(actorId));
            if (actorId == founderId) throw new ArgumentException("Founder identity is reserved", nameof(actorId));
            foreach (var scope in scopes) Canonical.RequireId(scope, nameof(scopes));
            var principal = new Principal(HashKey(key), "member", (string[])scopes.Clone());
            lock (sync) principals.Add(actorId, principal);
        }
        public ActorSession? Authenticate(string actorId, byte[] key, long expires)
        {
            // All methods that read both locks acquire clock before authority, also in SignWorld.
            lock (Clock.Sync)
            lock (sync)
            {
                long now = Clock.Tick;
                if (expires <= now || expires - now > 864000) throw new ArgumentOutOfRangeException(nameof(expires));
                if (key == null || key.Length != 32) return null;
                byte[] keyHash = HashKey(key);
                if (!principals.TryGetValue(actorId, out var p) || !ConstantEqual(p.KeyHash, keyHash)) return null;
                var session = new ActorSession(actorId, p.Role, now, expires, new HashSet<string>(p.Scopes, StringComparer.Ordinal));
                sessions.Add(session); return session;
            }
        }
        public bool IsValid(ActorSession? session)
        {
            lock (Clock.Sync)
            lock (sync)
            {
                long now = Clock.Tick;
                return session != null && now >= session.IssuedAt && now < session.Expires && sessions.Contains(session);
            }
        }
        public bool CanWrite(ActorSession session, string target)
        {
            lock (Clock.Sync)
            lock (sync) return IsValid(session) && (session.Role == "founder_dark" || session.Scope.Contains(target));
        }
        public void Revoke(ActorSession session) { lock (sync) sessions.Remove(session); }
        static byte[] HashKey(byte[] key)
        {
            if (key == null || key.Length != 32) throw new ArgumentException("Expected a random 32-byte credential", nameof(key));
            using (var hash = SHA256.Create()) return hash.ComputeHash(key);
        }
        static bool ConstantEqual(byte[] a, byte[] b)
        { int difference = a.Length ^ b.Length; for (int i = 0; i < a.Length && i < b.Length; i++) difference |= a[i] ^ b[i]; return difference == 0; }
    }
}
