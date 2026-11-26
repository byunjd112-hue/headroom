// 예시 5  화면이 쓰는 상태 묶음(스냅샷)과 주기 갱신 (CSC-SHELL)
// 모든 화면은 이 한 묶음만 본다 — 화면마다 따로 계산하지 않는다.
public sealed record PointValue(double? Value, int Quality, double? AgeSec);

public sealed record Snapshot(
    DateTimeOffset Time,
    IReadOnlyDictionary<string, PointValue> Values,   // "ESS.soc" → 값 · 품질
    IReadOnlyList<UnitState> Units,                   // 장비 한 대마다
    IReadOnlyList<LoadItem> Loads,                    // 부하 하나마다
    OpsState Ops,                                     // 운용 장소 · 태세 · 차단
    IReadOnlyList<Alarm> Alarms);

public sealed class SnapshotStore : INotifyPropertyChanged
{
    private readonly IEmsClient _client;              // 제어 SW 와의 연결
    private Snapshot? _current;
    public event PropertyChangedEventHandler? PropertyChanged;

    public SnapshotStore(IEmsClient client) => _client = client;

    public Snapshot? Current
    {
        get => _current;
        private set
        {
            _current = value;
            PropertyChanged?.Invoke(this, new(nameof(Current)));
        }
    }

    public async Task RunAsync(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(stop))
        {
            try { Current = await _client.GetSnapshotAsync(stop); }
            catch (EmsLinkException) { /* 연결 끊김: 마지막 값을 '오래됨'으로 표시 */ }
        }
    }
}
