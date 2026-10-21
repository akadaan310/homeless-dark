using System;
using System.Collections.Generic;
using System.Linq;
using Dark.Core;

namespace Dark.Population
{
    public sealed class Personality
    {
        public Personality(double sociability,double duty)
        {
            if(double.IsNaN(sociability)||double.IsNaN(duty)||sociability<0||sociability>1||duty<0||duty>1)throw new ArgumentOutOfRangeException(nameof(sociability));
            Sociability=sociability;Duty=duty;
        }
        public double Sociability{get;} public double Duty{get;}
    }
    public sealed class Observation
    {
        public Observation(string eventId,string actorId,string act,long tick,string cell)
        {
            EventId=Canonical.RequireId(eventId,nameof(eventId));ActorId=Canonical.RequireId(actorId,nameof(actorId));
            Act=Canonical.RequireId(act,nameof(act));Cell=Canonical.RequireId(cell,nameof(cell));
            if(tick<0)throw new ArgumentOutOfRangeException(nameof(tick));Tick=tick;
        }
        public string EventId{get;}public string ActorId{get;}public string Act{get;}public long Tick{get;}public string Cell{get;}
    }
    public sealed class Decision
    {
        internal Decision(string action,string witness,double utility){Action=action;Witness=witness;Utility=utility;}
        public string Action{get;}public string Witness{get;}public double Utility{get;}
    }
    public sealed class InhabitantSnapshot
    {
        internal InhabitantSnapshot(string id,Personality personality,string task,IEnumerable<Observation> observations)
        {Id=id;Personality=personality;Task=task;Observations=Array.AsReadOnly(observations.ToArray());}
        public string Id{get;}public Personality Personality{get;}public string Task{get;}public IReadOnlyList<Observation> Observations{get;}
    }
    public sealed class Inhabitant
    {
        readonly List<Observation> memories=new List<Observation>();readonly HashSet<string> seen=new HashSet<string>(StringComparer.Ordinal);
        public Inhabitant(string id,Personality personality,string task)
        {Id=Canonical.RequireId(id,nameof(id));Personality=personality??throw new ArgumentNullException(nameof(personality));Task=Canonical.RequireId(task,nameof(task));}
        public string Id{get;}public Personality Personality{get;}public string Task{get;}
        public IReadOnlyList<Observation> Memories=>Array.AsReadOnly(memories.ToArray());
        // Caller supplies an admitted local sensor result. Camera visibility is not implied.
        public bool Observe(Observation observation,string occupiedCell)
        {
            if(observation.Cell!=occupiedCell||memories.Count>=256||seen.Contains(observation.EventId))return false;
            if(memories.Count>0&&observation.Tick<memories[memories.Count-1].Tick)return false;
            seen.Add(observation.EventId);memories.Add(observation);return true;
        }
        public Decision DecideRide(string other,long tick)
        {
            if(tick<0)throw new ArgumentOutOfRangeException(nameof(tick));
            var greeting=memories.LastOrDefault(m=>m.ActorId==other&&m.Act=="greeting"&&m.Tick<=tick);
            double utility=Personality.Sociability-Personality.Duty;
            string action=greeting==null?"continue_task":utility>=0.25?"offer_ride":"decline_ride";
            return new Decision(action,Canonical.Hash("dark.utility/1",Id,other,Canonical.Number(tick),greeting?.EventId??"unobserved",action),utility);
        }
        public InhabitantSnapshot Snapshot()=>new InhabitantSnapshot(Id,Personality,Task,memories);
        public static Inhabitant Restore(InhabitantSnapshot snapshot)
        {
            var result=new Inhabitant(snapshot.Id,snapshot.Personality,snapshot.Task);
            foreach(var observation in snapshot.Observations)if(!result.Observe(observation,observation.Cell))throw new ArgumentException("Invalid memory sequence",nameof(snapshot));
            return result;
        }
    }
}
