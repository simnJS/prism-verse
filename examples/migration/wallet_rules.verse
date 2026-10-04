using { /Verse.org/Simulation }

MoneyToFloat(Rec:wallet_record)<transacts>:wallet_record =
    Rec.WithCoins(1.0 * Max(Rec.GetLegacyCoins(), 0))
