// 예시 6  선택 후 실행 지령의 화면 흐름 (CSC-DEV)
// 권한 확인 → 선택 → 운용자 확인 → 실행. 연동 조건이 맞지 않으면 사유를 보인다.
public sealed class DeviceCommandViewModel
{
    private readonly IEmsClient _client;
    private readonly IDialogService _dialog;
    private readonly ISession _session;

    public async Task StartAsync(string unitId, CancellationToken ct)
    {
        if (!_session.Has(Role.Operator)) { await _dialog.LoginAsync(); return; }

        SelectResult sel = await _client.SelectAsync(unitId, Command.Start, ct);
        if (!sel.Ok) { await _dialog.ErrorAsync(sel.Reason); return; }     // 연동 조건 불일치

        bool yes = await _dialog.ConfirmAsync($"{sel.UnitName} 을(를) 기동합니다. 계속합니까?");
        if (!yes) { await _client.CancelAsync(sel.Sid, ct); return; }

        OperateResult op = await _client.OperateAsync(sel.Sid, ct);
        await _dialog.ToastAsync(op.Ok ? "지령을 보냈습니다" : op.Reason, op.Ok);
    }
}
