// 예시 7  상태를 색과 글로 함께 보이기 (CSC-SLD · CSC-OVW)
// 차단 · 절감된 부하를 '급전 중'으로 보이지 않는다.
public enum LoadView { Fed, Reduced, Cut, Dead, Unknown }

public static class LoadPresenter
{
    public static LoadView Of(LoadItem load, OpsState ops, bool feederLive)
    {
        if (!feederLive) return LoadView.Dead;                        // 구간분전함 정전
        if (ops.CutGrades.Contains(load.Grade)) return LoadView.Cut;  // 등급 급전선 차단
        if (ops.ReducedGrades.Contains(load.Grade)) return LoadView.Reduced;
        return load.EstimatedKw is null ? LoadView.Unknown : LoadView.Fed;
    }

    public static (string Text, string ColorKey) Label(LoadView v, int grade) => v switch
    {
        LoadView.Fed     => ("급전 중", "ok"),
        LoadView.Reduced => ("절감 공급", "warn"),
        LoadView.Cut     => ($"{grade}등급 자동 차단 · 정전", "warn"),
        LoadView.Dead    => ("정전", "alarm"),
        _                => ("값 없음", "idle"),
    };
}
