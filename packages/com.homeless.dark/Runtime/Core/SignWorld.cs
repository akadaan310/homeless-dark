using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using Dark.History;

namespace Dark.Core
{
    public sealed class EffectResult
    {
        internal EffectResult(bool admitted,string code,string clause,string eventHash,long revision)
        {Admitted=admitted;Code=code;Clause=clause;EventHash=eventHash;Revision=revision;}
        public bool Admitted{get;} public string Code{get;} public string Clause{get;} public string EventHash{get;} public long Revision{get;}
    }
    // [C] Small event-sourced authoring domain, not the entire shared world.
    public sealed class SignWorld
    {
        readonly object sync=new object();readonly LocalAuthority authority;readonly AdmissionPolicy policy;readonly IEventSink? sink;
        readonly Dictionary<string,string> signs=new Dictionary<string,string>(StringComparer.Ordinal);
        readonly List<JournalEvent> events=new List<JournalEvent>();
        readonly Dictionary<string,JournalEvent> requests=new Dictionary<string,JournalEvent>(StringComparer.Ordinal);
        public SignWorld(LocalAuthority authority,AdmissionPolicy policy,IEventSink? sink=null)
        {this.authority=authority??throw new ArgumentNullException(nameof(authority));this.policy=policy??throw new ArgumentNullException(nameof(policy));this.sink=sink;}
        public long Revision{get{lock(sync)return events.Count;}}
        public string Head{get{lock(sync)return events.Count==0?JournalEvent.Genesis:events[events.Count-1].Hash;}}
        public IReadOnlyList<JournalEvent> Events{get{lock(sync)return Array.AsReadOnly(events.ToArray());}}
        public IReadOnlyDictionary<string,string> Signs{get{lock(sync)return new ReadOnlyDictionary<string,string>(new Dictionary<string,string>(signs,StringComparer.Ordinal));}}
        public EffectResult SetSign(ActorSession? session,string requestId,long expectedRevision,long tick,string target,string value)
        {
            // Serialize clock advancement with authentication, persistence and commit admission.
            lock(sync)
            lock(authority.Clock.Sync)
            {
                EffectResult Refuse(string code,string clause="HD_073")=>new EffectResult(false,code,clause,"",events.Count);
                if(!authority.IsValid(session))return Refuse("unauthenticated","HD_029");
                try{Canonical.RequireId(requestId,nameof(requestId));Canonical.RequireId(target,nameof(target));}
                catch(ArgumentException){return Refuse("invalid_identifier");}
                if(value==null)return Refuse("invalid_value");
                int bytes;try{bytes=Canonical.Utf8.GetByteCount(value);}catch(ArgumentException){return Refuse("invalid_unicode");}
                if(!authority.CanWrite(session!,target))return Refuse("scope_denied");
                string key=Canonical.Hash(session!.ActorId,requestId);
                string digest=JournalEvent.RequestHash(session.ActorId,requestId,expectedRevision,tick,target,value);
                if(requests.TryGetValue(key,out var existing))
                    return existing.RequestDigest==digest?Accepted(existing):Refuse("idempotency_conflict");
                // Authenticated retries retain their original tick/digest; new effects must use current simulation time.
                if(tick!=authority.Clock.Tick)return Refuse("noncurrent_tick","HD_015");
                var verdict=policy.Evaluate("sign","set_sign",new AdmissionContext(true,true,session.Role=="founder_dark",expectedRevision==events.Count,bytes));
                if(!verdict.Admitted)return Refuse(verdict.Code,verdict.Clause);
                if(events.Count>0&&tick<events[events.Count-1].Tick)return Refuse("stale_tick","HD_015");
                if(events.Count>=100000)return Refuse("history_budget_exceeded","HD_060");
                var item=new JournalEvent(events.Count+1L,tick,requestId,expectedRevision,session.ActorId,target,value,policy.Digest,verdict.Clause,Head);
                try{sink?.Append(item);}catch(Exception e)when(e is IOException||e is UnauthorizedAccessException||e is JournalException){return Refuse("storage_failed","HD_078");}
                Apply(item);return Accepted(item);
            }
        }
        static EffectResult Accepted(JournalEvent e)=>new EffectResult(true,"admitted",e.Clause,e.Hash,e.Sequence);
        void Apply(JournalEvent e){events.Add(e);signs[e.TargetId]=e.Value;requests.Add(Canonical.Hash(e.ActorId,e.RequestId),e);}
        public static SignWorld Restore(LocalAuthority authority,AdmissionPolicy policy,IEnumerable<string> lines,string trustedHead,IEventSink? sink=null)
        {
            var replay=EventJournal.Verify(lines,trustedHead,policy.Digest);var world=new SignWorld(authority,policy,sink);
            foreach(var e in replay.Events)
            {
                var verdict=policy.Evaluate("sign","set_sign",new AdmissionContext(true,true,false,true,Canonical.Utf8.GetByteCount(e.Value)));
                if(!verdict.Admitted||e.Clause!=verdict.Clause)throw new JournalException("Recorded event violates policy");
                world.Apply(e);
            }
            return world;
        }
    }
}
