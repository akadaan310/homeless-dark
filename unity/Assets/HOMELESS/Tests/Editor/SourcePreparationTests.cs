using NUnit.Framework;
using UnityEngine;
using UnityEditor;
using Homeless.Editor;

public sealed class SourcePreparationTests
{
    [Test] public void RoughnessPackingPreservesLinearOcclusionAndInvertsSmoothness()
    {
        Color32 packed = SurfaceImporter.Pack(64, 192);
        Assert.AreEqual(0, packed.r); Assert.AreEqual(192, packed.g); Assert.AreEqual(191, packed.a);
    }
    [Test] public void ImportedCafeRetainsMeterScaleAndPassableEntrance()
    {
        SourceSceneBuilder.PrepareArtReview();
        var cafe = GameObject.Find("FictionalCafe");
        Assert.NotNull(cafe); Assert.AreEqual(Vector3.one, cafe.transform.localScale);
        Assert.IsFalse(Physics.CheckSphere(new Vector3(6f, 1.1f, 0), 0.3f), "Entrance must remain clear");
        Assert.IsTrue(Physics.Raycast(new Vector3(6f, 2f, 2f), Vector3.down, out var hit, 3f), "Interior floor must support a visitor");
        Assert.Greater(hit.normal.y, 0.7f);
    }
    [Test] public void AndroidReleaseGateRefusesUnverifiedHeroContent()
    {
        Assert.Throws<BuildPrerequisiteException>(() => SourceSceneBuilder.ValidateGameplayContent());
    }
}
