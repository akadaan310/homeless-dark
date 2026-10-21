using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Dark.Population
{
    /// <summary>One observed demographic estimate. Code is a source economy ID, not an ethnicity.</summary>
    public sealed class PopulationShard
    {
        public string Code { get; }
        public string Name { get; }
        public string Region { get; }
        public ulong Count { get; }
        public PopulationShard(string code, string name, string region, ulong count)
        {
            if (!PopulationLedger.Token(code) || !PopulationLedger.Token(region) || string.IsNullOrWhiteSpace(name))
                throw new ArgumentException("invalid population shard");
            Code=code; Name=name; Region=region; Count=count;
        }
    }

    public enum PopulationFidelity { Persistent, Active, Focused }

    /// <summary>Detached view. Synthetic parameters are policy seeds, not measured demographic attributes.</summary>
    public sealed class PopulationPerson
    {
        public string Id { get; }
        public string Origin { get; }
        public ulong Ordinal { get; }
        public string Residence { get; }
        public string Present { get; }
        public PopulationFidelity Fidelity { get; }
        public string PolicySeed { get; }
        public IReadOnlyList<string> Facts { get; }
        public IReadOnlyList<string> Commitments { get; }
        public ulong LastEventRevision { get; }
        internal PopulationPerson(string id,string origin,ulong ordinal,string residence,string present,
            PopulationFidelity fidelity,string seed,IEnumerable<string> facts,IEnumerable<string> commitments,ulong last)
        {
            Id=id; Origin=origin; Ordinal=ordinal; Residence=residence; Present=present; Fidelity=fidelity;
            PolicySeed=seed; Facts=Array.AsReadOnly(facts.ToArray()); Commitments=Array.AsReadOnly(commitments.ToArray()); LastEventRevision=last;
        }
    }

    public sealed class PopulationCounts
    {
        public ulong Residents { get; }
        public ulong Present { get; }
        public ulong Visitors { get; }
        public ulong AbsentResidents { get; }
        internal PopulationCounts(ulong residents,ulong present,ulong visitors,ulong absent)
        { Residents=residents; Present=present; Visitors=visitors; AbsentResidents=absent; }
    }

    public sealed class PopulationMovement
    {
        public string RequestId { get; }
        public string PersonId { get; }
        public string Destination { get; }
        public bool Migration { get; }
        public ulong Revision { get; }
        internal PopulationMovement(string request,string person,string destination,bool migration,ulong revision)
        { RequestId=request; PersonId=person; Destination=destination; Migration=migration; Revision=revision; }
    }

    /// <summary>
    /// Country/economy ranges, region totals and 64 non-spatial ordinal cohorts. Only touched people consume state.
    /// Single-writer deterministic reference; renderer activation never creates additional population.
    /// Bounds refuse new work rather than silently forgetting a known person's facts or commitments.
    /// </summary>
    public sealed class PopulationLedger
    {
        private sealed class State
        {
            public string Id="", Origin="", Residence="", Present="", Seed="";
            public ulong Ordinal, Last;
            public PopulationFidelity Fidelity;
            public readonly List<string> Facts=new List<string>();
            public readonly List<string> Commitments=new List<string>();
        }
        private readonly SortedDictionary<string,PopulationShard> shards=new SortedDictionary<string,PopulationShard>(StringComparer.Ordinal);
        private readonly Dictionary<string,ulong> residents=new Dictionary<string,ulong>(StringComparer.Ordinal);
        private readonly Dictionary<string,ulong> present=new Dictionary<string,ulong>(StringComparer.Ordinal);
        private readonly Dictionary<string,State> states=new Dictionary<string,State>(StringComparer.Ordinal);
        private readonly Dictionary<string,PopulationMovement> requests=new Dictionary<string,PopulationMovement>(StringComparer.Ordinal);
        private readonly List<PopulationMovement> movements=new List<PopulationMovement>();
        public string SourceEpoch { get; }
        public string AllocationHash { get; }
        public ulong Total { get; }
        public ulong Revision { get; private set; }
        public int MaxActive { get; }
        public int MaxStored { get; }
        public int MaxMovements { get; }
        public int StoredIndividuals => states.Count;
        public int ActiveIndividuals => states.Values.Count(s=>s.Fidelity!=PopulationFidelity.Persistent);
        public int FocusedIndividuals => states.Values.Count(s=>s.Fidelity==PopulationFidelity.Focused);
        public ulong VirtualIndividuals => Total-(ulong)states.Count;
        public IReadOnlyList<PopulationShard> Shards => Array.AsReadOnly(shards.Values.ToArray());
        public IReadOnlyList<PopulationMovement> Movements => Array.AsReadOnly(movements.ToArray());
        internal static bool Token(string value) => !string.IsNullOrEmpty(value) && value.Length<=64 && value.All(c=>c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c=='_'||c=='-');
        private static string Hash(string text) { using(var h=SHA256.Create()) return string.Concat(h.ComputeHash(Encoding.UTF8.GetBytes(text)).Select(b=>b.ToString("x2",CultureInfo.InvariantCulture))); }

        public PopulationLedger(IEnumerable<PopulationShard> source,string sourceEpoch="wb2024",int maxActive=256,int maxStored=4096,int maxMovements=8192)
        {
            if(!Token(sourceEpoch)||maxActive<0||maxStored<maxActive||maxStored>1000000||maxMovements<0||maxMovements>1000000)
                throw new ArgumentException("invalid ledger bounds");
            SourceEpoch=sourceEpoch; MaxActive=maxActive; MaxStored=maxStored; MaxMovements=maxMovements;
            ulong total=0;
            foreach(var shard in source??throw new ArgumentNullException(nameof(source)))
            {
                if(shard==null||shards.ContainsKey(shard.Code)) throw new ArgumentException("duplicate or null population shard");
                shards.Add(shard.Code,shard); residents.Add(shard.Code,shard.Count); present.Add(shard.Code,shard.Count);
                total=checked(total+shard.Count);
            }
            if(shards.Count==0) throw new ArgumentException("empty population source");
            Total=total;
            AllocationHash=Hash("dark.population/1\n"+sourceEpoch+"\n"+string.Join("\n",shards.Values.Select(s=>s.Code+"\t"+s.Region+"\t"+s.Count.ToString(CultureInfo.InvariantCulture))));
        }

        public string Identity(string origin,ulong ordinal)
        {
            if(!shards.TryGetValue(origin,out var shard)||ordinal>=shard.Count) throw new ArgumentOutOfRangeException(nameof(ordinal),"identity outside allocated source range");
            return SourceEpoch+"/"+origin+"/"+ordinal.ToString(CultureInfo.InvariantCulture);
        }
        private State Initial(string id)
        {
            var parts=(id??"").Split('/');
            if(parts.Length!=3||parts[0]!=SourceEpoch||!ulong.TryParse(parts[2],NumberStyles.None,CultureInfo.InvariantCulture,out var ordinal)||Identity(parts[1],ordinal)!=id)
                throw new ArgumentException("noncanonical or unknown population identity");
            return new State{Id=id!,Origin=parts[1],Ordinal=ordinal,Residence=parts[1],Present=parts[1],Seed=Hash("dark.policy-seed/1\n"+id),Fidelity=PopulationFidelity.Persistent};
        }
        private static PopulationPerson View(State state) => new PopulationPerson(state.Id,state.Origin,state.Ordinal,state.Residence,state.Present,state.Fidelity,state.Seed,state.Facts,state.Commitments,state.Last);
        public PopulationPerson Resolve(string id) => View(states.TryGetValue(id,out var state)?state:Initial(id));
        public ulong CohortMembers(string origin,int cohort)
        {
            if(cohort<0||cohort>=64||!shards.TryGetValue(origin,out var shard)) throw new ArgumentOutOfRangeException(nameof(cohort));
            return shard.Count/64+((ulong)cohort<shard.Count%64?1UL:0UL);
        }
        public IReadOnlyDictionary<string,ulong> RegionTotals()
        {
            var result=new SortedDictionary<string,ulong>(StringComparer.Ordinal);
            foreach(var shard in shards.Values) result[shard.Region]=checked((result.TryGetValue(shard.Region,out var n)?n:0)+residents[shard.Code]);
            return new System.Collections.ObjectModel.ReadOnlyDictionary<string,ulong>(result);
        }
        private State Obtain(string id)
        {
            if(states.TryGetValue(id,out var existing)) return existing;
            var next=Initial(id);
            if(states.Count>=MaxStored) throw new InvalidOperationException("stored_population_budget");
            states.Add(id,next); return next;
        }
        public PopulationPerson Promote(string id,PopulationFidelity fidelity=PopulationFidelity.Active)
        {
            if(!Enum.IsDefined(typeof(PopulationFidelity),fidelity)) throw new ArgumentException("unknown fidelity");
            bool wasActive=states.TryGetValue(id,out var prior)&&prior.Fidelity!=PopulationFidelity.Persistent;
            // Validate identity before the capacity check; no half-promotion on refusal.
            if(prior==null) Initial(id);
            if(fidelity!=PopulationFidelity.Persistent&&!wasActive&&ActiveIndividuals>=MaxActive) throw new InvalidOperationException("active_population_budget");
            var state=Obtain(id); state.Fidelity=fidelity; return View(state);
        }
        public PopulationPerson Demote(string id)
        {
            // A virtual unknown member need not acquire an allocated state just to stay virtual.
            if(!states.TryGetValue(id,out var state)) return Resolve(id);
            state.Fidelity=PopulationFidelity.Persistent; return View(state);
        }
        private static void ValidateMemory(string value)
        { if(string.IsNullOrWhiteSpace(value)||new UTF8Encoding(false,true).GetByteCount(value)>512) throw new ArgumentException("invalid memory item"); }
        public void Remember(string id,string fact)
        {
            ValidateMemory(fact);
            if(states.TryGetValue(id,out var existing)&&existing.Facts.Contains(fact)) return;
            if(existing!=null&&existing.Facts.Count>=64) throw new InvalidOperationException("fact_budget");
            Obtain(id).Facts.Add(fact);
        }
        public void CommitTo(string id,string commitment)
        {
            ValidateMemory(commitment);
            if(states.TryGetValue(id,out var existing)&&existing.Commitments.Contains(commitment)) return;
            if(existing!=null&&existing.Commitments.Count>=64) throw new InvalidOperationException("commitment_budget");
            Obtain(id).Commitments.Add(commitment);
        }
        public bool CompleteCommitment(string id,string commitment)
        { Initial(id); return states.TryGetValue(id,out var state)&&state.Commitments.Remove(commitment); }
        public PopulationCounts Counts(string code)
        {
            if(!shards.ContainsKey(code)) throw new ArgumentException("unknown population shard");
            return new PopulationCounts(residents[code],present[code],(ulong)states.Values.Count(s=>s.Present==code&&s.Residence!=code),(ulong)states.Values.Count(s=>s.Residence==code&&s.Present!=code));
        }
        public PopulationMovement Move(string id,string destination,string requestId,ulong expectedRevision,bool migration=false)
        {
            if(!Token(requestId)||!shards.ContainsKey(destination)) throw new ArgumentException("invalid movement destination or request");
            Initial(id);
            if(requests.TryGetValue(requestId,out var previous))
            {
                if(previous.PersonId!=id||previous.Destination!=destination||previous.Migration!=migration) throw new InvalidOperationException("request_conflict");
                return previous;
            }
            if(expectedRevision!=Revision) throw new InvalidOperationException("stale_population_revision");
            if(movements.Count>=MaxMovements) throw new InvalidOperationException("movement_history_budget");
            if(Revision==ulong.MaxValue) throw new InvalidOperationException("population_revision_exhausted");
            var state=Obtain(id);
            // Each traveler has exactly one present shard. A move is a single atomic reference transition.
            if(state.Present!=destination) { present[state.Present]--; present[destination]++; state.Present=destination; }
            if(migration&&state.Residence!=destination) { residents[state.Residence]--; residents[destination]++; state.Residence=destination; }
            Revision++; state.Last=Revision;
            var movement=new PopulationMovement(requestId,id,destination,migration,Revision);
            movements.Add(movement); requests.Add(requestId,movement); return movement;
        }

        /// <summary>Canonical bounded snapshot with checksum. Store atomically in the host; checksum is integrity, not authenticity.</summary>
        public string Save()
        {
            var lines=new List<string>{"dark.population-snapshot/1",AllocationHash,Revision.ToString(CultureInfo.InvariantCulture)};
            foreach(var state in states.Values.OrderBy(s=>s.Id,StringComparer.Ordinal))
            {
                lines.Add("S\t"+state.Id+"\t"+state.Residence+"\t"+state.Present+"\t"+(int)state.Fidelity+"\t"+state.Last.ToString(CultureInfo.InvariantCulture));
                foreach(var fact in state.Facts) lines.Add("F\t"+state.Id+"\t"+Convert.ToBase64String(Encoding.UTF8.GetBytes(fact)));
                foreach(var commitment in state.Commitments) lines.Add("C\t"+state.Id+"\t"+Convert.ToBase64String(Encoding.UTF8.GetBytes(commitment)));
            }
            foreach(var move in movements) lines.Add("M\t"+move.RequestId+"\t"+move.PersonId+"\t"+move.Destination+"\t"+(move.Migration?"1":"0")+"\t"+move.Revision.ToString(CultureInfo.InvariantCulture));
            string payload=string.Join("\n",lines)+"\n";
            return payload+"H\t"+Hash(payload)+"\n";
        }

        public static PopulationLedger Restore(IEnumerable<PopulationShard> source,string snapshot,string sourceEpoch="wb2024",int maxActive=256,int maxStored=4096,int maxMovements=8192)
        {
            if(snapshot==null||snapshot.Length>128*1024*1024) throw new ArgumentException("snapshot budget");
            var result=new PopulationLedger(source,sourceEpoch,maxActive,maxStored,maxMovements);
            var lines=snapshot.Split('\n');
            if(lines.Length<5||lines[0]!="dark.population-snapshot/1"||lines[1]!=result.AllocationHash||lines[lines.Length-1]!=""||!lines[lines.Length-2].StartsWith("H\t",StringComparison.Ordinal)) throw new ArgumentException("snapshot header");
            string payload=string.Join("\n",lines.Take(lines.Length-2))+"\n";
            if(lines[lines.Length-2]!="H\t"+Hash(payload)) throw new ArgumentException("snapshot checksum");
            if(!ulong.TryParse(lines[2],NumberStyles.None,CultureInfo.InvariantCulture,out var revision)) throw new ArgumentException("snapshot revision");
            var seenStates=new HashSet<string>(StringComparer.Ordinal);
            var desired=new Dictionary<string,(string home,string present,ulong last)>(StringComparer.Ordinal);
            foreach(string line in lines.Skip(3).Take(lines.Length-5))
            {
                var fields=line.Split('\t');
                if(fields.Length==6&&fields[0]=="S")
                {
                    if(!seenStates.Add(fields[1])||!result.shards.ContainsKey(fields[2])||!result.shards.ContainsKey(fields[3])||!int.TryParse(fields[4],out var level)||!Enum.IsDefined(typeof(PopulationFidelity),level)||!ulong.TryParse(fields[5],NumberStyles.None,CultureInfo.InvariantCulture,out var last)||last>revision) throw new ArgumentException("snapshot state");
                    result.Promote(fields[1],(PopulationFidelity)level);
                    desired.Add(fields[1],(fields[2],fields[3],last));
                }
                else if(fields.Length==3&&(fields[0]=="F"||fields[0]=="C"))
                {
                    if(!seenStates.Contains(fields[1])) throw new ArgumentException("snapshot memory without state");
                    string value=new UTF8Encoding(false,true).GetString(Convert.FromBase64String(fields[2]));
                    if(fields[0]=="F") result.Remember(fields[1],value); else result.CommitTo(fields[1],value);
                }
                else if(fields.Length==6&&fields[0]=="M")
                {
                    if((fields[4]!="0"&&fields[4]!="1")||!ulong.TryParse(fields[5],NumberStyles.None,CultureInfo.InvariantCulture,out var moveRevision)||moveRevision!=result.Revision+1||!seenStates.Contains(fields[2])) throw new ArgumentException("snapshot movement");
                    result.Move(fields[2],fields[3],fields[1],result.Revision,fields[4]=="1");
                }
                else throw new ArgumentException("snapshot record");
            }
            if(result.Revision!=revision) throw new ArgumentException("snapshot missing movement history");
            foreach(var pair in desired)
            {
                var state=result.states[pair.Key];
                if(state.Residence!=pair.Value.home||state.Present!=pair.Value.present||state.Last!=pair.Value.last) throw new ArgumentException("snapshot movement reconciliation");
            }
            if(result.Save()!=snapshot) throw new ArgumentException("noncanonical snapshot");
            return result;
        }
    }
}
