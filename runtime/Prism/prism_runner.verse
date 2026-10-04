using { /Verse.org/Simulation }
using { /Fortnite.com/Playspaces }

# Implemented by every generated store.
prism_store<public> := interface<computes>:
    StoreName<public>()<computes>:string
    Open<public>(Who:player):void
    Flush<public>(Who:player, Force:logic):void
    Close<public>(Who:player):void
    FlushAll<public>(Force:logic):void
    Pump<public>(Debounce:float):void

# Loads players as they join and writes a changed player at most once per FlushSeconds (0 = at the next tick; Commit
# always writes at the next tick). Saved players are rewritten every HeartbeatSeconds to keep LastSeen fresh, and when Run ends.
prism_runner<public> := class:
    Stores<public>:[]prism_store = array{}
    FlushSeconds<public>:float = 1.0
    HeartbeatSeconds<public>:float = 60.0

    Run<public>(Playspace:fort_playspace)<suspends>:void =
        var Subscriptions:[]cancelable = array{}
        defer:
            for (S : Subscriptions):
                S.Cancel()
            FlushAll()
        for (Who : Playspace.GetPlayers()):
            Open(Who)
        set Subscriptions = array{Playspace.PlayerAddedEvent().Subscribe(Open), Playspace.PlayerRemovedEvent().Subscribe(Close)}
        sync:
            Heartbeat()
            PumpEveryTick()

    Open<public>(Who:player):void =
        for (S : Stores):
            S.Open(Who)

    Close<public>(Who:player):void =
        for (S : Stores):
            S.Close(Who)

    FlushAll<public>():void =
        for (S : Stores):
            S.FlushAll(true)

    Heartbeat<private>()<suspends>:void =
        if (HeartbeatSeconds <= 0.0):
            Sleep(Inf)
        loop:
            Sleep(HeartbeatSeconds)
            FlushAll()

    PumpEveryTick<private>()<suspends>:void =
        loop:
            Sleep(0.0)
            for (S : Stores):
                S.Pump(FlushSeconds)
