using { /Verse.org/Simulation }

IsKnownRank(It:rank)<computes><decides>:void =
    It <> rank.Gold

IsGoodSpot(It:spot)<computes><decides>:void =
    It.Uid > 0

CoverageRename(Rec:coverage_profile)<transacts>:coverage_profile =
    if (Rec.GetName() = "") then Rec.WithName(Rec.GetOldName()) else Rec

CoverageLoaded(Who:player, Profile:player_profile):void =
    if (Profile.OfflineSeconds > 0.0):
        Profile.DbSetCursor(0)
