using System.Collections.Generic;
using UnityEngine;

namespace Homeless.Unity.Gameplay
{
    // Cosmetic source-pivot articulation follows admitted displacement; it never moves the vehicle root.
    public sealed class WorldVehicleMotion : MonoBehaviour
    {
        readonly List<Pivot> pivots = new List<Pivot>();
        string mode;
        float rotorAngle;
        public void Bind(string vehicleMode)
        {
            mode = vehicleMode; pivots.Clear();
            foreach (var part in GetComponentsInChildren<Transform>())
            {
                if (mode == "bike" && (part.name == "FrontWheel" || part.name == "RearWheel" || part.name == "Crank"))
                    pivots.Add(new Pivot { Part = part, Rest = part.localRotation, Axis = Vector3.right, Multiplier = part.name == "Crank" ? .4f : 1 });
                if (mode == "helicopter" && (part.name == "MainRotor" || part.name == "TailRotor"))
                    pivots.Add(new Pivot { Part = part, Rest = part.localRotation, Axis = Vector3.forward, Multiplier = part.name == "TailRotor" ? 2 : 1 });
            }
        }
        public void ObserveDisplacement(Vector3 displacement)
        {
            float distance = displacement.magnitude;
            if (distance <= .00001f || distance > 50) return; // no movement during pauses or origin rebases
            if (mode == "bike")
            {
                float sign = Vector3.Dot(displacement, transform.forward) >= 0 ? 1 : -1;
                foreach (var pivot in pivots)
                {
                    pivot.Angle = Mathf.Repeat(pivot.Angle - sign * distance / .34f * Mathf.Rad2Deg * pivot.Multiplier, 360);
                    pivot.Part.localRotation = pivot.Rest * Quaternion.AngleAxis(pivot.Angle, pivot.Axis);
                }
            }
            else if (mode == "helicopter")
            {
                // A declared visual loop while observed flight moves; RPM/aerodynamics are not simulated here.
                rotorAngle = Mathf.Repeat(rotorAngle + Mathf.Min(Time.unscaledDeltaTime, .1f) * 720, 360);
                foreach (var pivot in pivots) pivot.Part.localRotation = pivot.Rest * Quaternion.AngleAxis(rotorAngle * pivot.Multiplier, pivot.Axis);
            }
        }
        sealed class Pivot { public Transform Part; public Quaternion Rest; public Vector3 Axis; public float Multiplier, Angle; }
    }
}
