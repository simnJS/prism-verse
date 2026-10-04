using { /Verse.org/Simulation }

MoneyToFloat(Rec:wallet_record)<transacts>:wallet_record =
    Rec.WithMoney(1.0 * Max(Rec.Coins, 0))
