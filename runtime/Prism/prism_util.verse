using { /Verse.org/Simulation }

# Why a save was not written.
prism_block<public> := enum{TooLarge}

# A record whose PrismSize (an upper bound) is under this budget fits the 256 KB player map: it is written without
# calling the slow FitsInPlayerMap. 252 KB: the limit minus a margin.
PrismPlayerMapBudget<public>:int = 258048

# Above this bound, FitsInPlayerMap is never called (one call could take seconds): @trim lists are cut by arithmetic.
PrismFitsCheckMax<public>:int = 1048576

# A record checked with FitsInPlayerMap is checked again at most this often; a blocked save is retried this late.
PrismLargeRecordSeconds<public>:float = 5.0
PrismBlockedRetrySeconds<public>:float = 10.0

PrismNow<public>()<reads>:float = GetSecondsSinceEpoch()

# 0 when the player was never saved.
PrismOfflineSeconds<public>(LastSeen:float)<reads>:float =
    if (LastSeen > 0.0) then Max(0.0, GetSecondsSinceEpoch() - LastSeen) else 0.0

# Persisted integers must fit in 64 bits.
PrismInt64<public>(Value:int)<computes>:int =
    Clamp(Value, -9223372036854775807 - 1, 9223372036854775807)

PrismSum<public>(Values:[]int)<transacts>:int =
    var Total:int = 0
    for (Value : Values):
        set Total += Value
    Total

# Highest id + 1 (1 for an empty list), so a counter never hands out an id already in use.
(Ids:[]int).PrismNextId<public>()<transacts>:int =
    var Top:int = 0
    for (Id : Ids):
        set Top = Max(Top, Id)
    Top + 1

# How many items fit in Budget bytes, counted from the start or from the end of the list.
PrismFitCount<public>(Sizes:[]int, Budget:int, FromEnd:logic)<transacts>:int =
    var Used:int = 0
    var Count:int = 0
    Total := Sizes.Length
    loop:
        Index := if (FromEnd?) then Total - 1 - Count else Count
        if (Count < Total, Size := Sizes[Index], Used + Size <= Budget):
            set Used += Size
            set Count += 1
        else:
            break
    Count

(Items:[]t where t:subtype(comparable)).PrismContains<public>(Value:t)<computes><decides>:void =
    first(Item : Items, Item = Value). Item

(Items:[]t where t:type).PrismKeepFirst<public>(Count:int)<computes>:[]t =
    if (Head := Items.Slice[0, Count]) then Head else Items

(Items:[]t where t:type).PrismKeepLast<public>(Count:int)<computes>:[]t =
    if (Count < Items.Length, Tail := Items.Slice[Items.Length - Max(Count, 0)]) then Tail else Items

PrismLog<public>(Store:string, Text:string):void =
    Print("[prism] {Store}: {Text}")

# Rows of a list saved as columns: the longest column (a column added later is shorter in old saves).
PrismMaxLength<public>(Lengths:[]int)<transacts>:int =
    var Longest:int = 0
    for (Length : Lengths):
        set Longest = Max(Longest, Length)
    Longest
