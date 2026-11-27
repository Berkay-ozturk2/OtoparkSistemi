using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Tests;

public class SubscriptionTests : IDisposable
{
    private readonly TestDb _t = new();
    private readonly SubscriptionService _svc;
    private readonly int _driverId;
    private const string Plate = "06ABC123";

    public SubscriptionTests()
    {
        _svc = new SubscriptionService(_t.Db, new SubscriptionPricing { MonthlyPrice = 1500m, YearlyPrice = 15000m }, _t.Clock);
        var driver = _t.Db.Users.First(u => u.Role == UserRole.Driver);
        _driverId = driver.Id;
        if (!_t.Db.Vehicles.Any(v => v.UserId == _driverId && v.Plate == Plate))
        {
            _t.Db.Vehicles.Add(new Vehicle { UserId = _driverId, Plate = Plate, CreatedAt = _t.Now });
            _t.Db.SaveChanges();
        }
    }

    public void Dispose() => _t.Dispose();

    private CreateSubscriptionRequest Req(SubscriptionPlan? plan = SubscriptionPlan.Monthly, string plate = "06 abc 123",
        string? lot = "GAZI", string? name = "Örnek Sürücü", string? phone = "0532 111 22 33", DateTime? start = null) =>
        new(plate, lot, plan, name, phone, start);

    [Fact]
    public void Plans_show_yearly_saving()
    {
        var plans = _svc.GetPlans();
        Assert.Equal(2, plans.Count);
        var yearly = plans.Single(p => p.Plan == SubscriptionPlan.Yearly);
        Assert.Equal(1250m, yearly.MonthlyEquivalent);
        Assert.Equal(17, yearly.SavingPercent);
    }

    [Fact]
    public async Task Create_validates_input_with_clear_messages()
    {
        var noPlan = await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(_driverId, Req(plan: null)));
        Assert.Contains("paket", noPlan.Message);

        var badPhone = await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(_driverId, Req(phone: "123")));
        Assert.Contains("05XX", badPhone.Message);

        var past = await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(_driverId, Req(start: _t.Now.AddDays(-2))));
        Assert.Contains("bugünden önce", past.Message);

        var notMine = await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(_driverId, Req(plate: "34ZZZ999")));
        Assert.Contains("kayıtlı araç", notMine.Message);
    }

    [Fact]
    public async Task Create_then_approve_sets_dates_and_blocks_duplicates()
    {
        var created = await _svc.CreateAsync(_driverId, Req(SubscriptionPlan.Yearly));
        Assert.Equal(SubscriptionStatus.Pending, created.Status);
        Assert.Equal(15000m, created.Price);
        Assert.Equal("05321112233", created.Phone);

        var dup = await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(_driverId, Req()));
        Assert.Equal(409, dup.StatusCode);

        var approved = await _svc.AdminUpdateAsync(created.Id, new UpdateSubscriptionRequest(SubscriptionStatus.Active, null), "admin@otopark.local");
        Assert.Equal(SubscriptionStatus.Active, approved.Status);
        Assert.Equal(approved.StartDate.AddMonths(12), approved.EndDate);
        Assert.True(approved.IsCurrent);

        // Devam eden abonelik varken aynı otoparkta yeni başvuru olmaz
        var again = await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(_driverId, Req()));
        Assert.Equal(409, again.StatusCode);

        // Süre dolunca sona ermiş sayılır ve yeniden başvurulabilir
        _t.Clock.Advance(TimeSpan.FromDays(370));
        var mine = await _svc.GetMyAsync(_driverId);
        Assert.True(mine.Single().IsExpired);
        await _svc.CreateAsync(_driverId, Req());
    }

    [Fact]
    public async Task Reject_requires_reason_and_only_pending_can_be_withdrawn()
    {
        var created = await _svc.CreateAsync(_driverId, Req());
        var noReason = await Assert.ThrowsAsync<AppException>(() =>
            _svc.AdminUpdateAsync(created.Id, new UpdateSubscriptionRequest(SubscriptionStatus.Rejected, " "), "admin"));
        Assert.Contains("gerekçe", noReason.Message);

        var rejected = await _svc.AdminUpdateAsync(created.Id, new UpdateSubscriptionRequest(SubscriptionStatus.Rejected, "Ruhsat okunmuyor"), "admin");
        Assert.Equal(SubscriptionStatus.Rejected, rejected.Status);
        Assert.Equal("Ruhsat okunmuyor", rejected.Note);

        await Assert.ThrowsAsync<AppException>(() => _svc.CancelOwnAsync(_driverId, created.Id));

        var second = await _svc.CreateAsync(_driverId, Req());
        var withdrawn = await _svc.CancelOwnAsync(_driverId, second.Id);
        Assert.Equal(SubscriptionStatus.Cancelled, withdrawn.Status);
    }

    [Fact]
    public async Task Report_counts_approvals_by_month()
    {
        var a = await _svc.CreateAsync(_driverId, Req(SubscriptionPlan.Monthly));
        await _svc.AdminUpdateAsync(a.Id, new UpdateSubscriptionRequest(SubscriptionStatus.Active, null), "admin");

        var other = new Vehicle { UserId = _driverId, Plate = "34KLM456", CreatedAt = _t.Now };
        _t.Db.Vehicles.Add(other);
        await _t.Db.SaveChangesAsync();
        var b = await _svc.CreateAsync(_driverId, Req(SubscriptionPlan.Yearly, plate: "34KLM456"));
        await _svc.AdminUpdateAsync(b.Id, new UpdateSubscriptionRequest(SubscriptionStatus.Active, null), "admin");
        await _svc.CreateAsync(_driverId, Req(plate: "34KLM456", lot: _t.Db.ParkingLots.AsNoTracking().First(l => l.Code != "GAZI").Code));

        var report = await _svc.GetReportAsync(_t.Now.Year, null);
        Assert.Equal(1, report.NewMonthly);
        Assert.Equal(1, report.NewYearly);
        Assert.Equal(16500m, report.Revenue);
        Assert.Equal(2, report.ActiveNow);
        Assert.Equal(1, report.Pending);
        Assert.Equal(0, report.ExpiringSoon);
        var month = report.Months.Single(m => m.Month == _t.Now.Month);
        Assert.Equal(16500m, month.Revenue);

        // 20 gün sonra aylık abonelik "yakında bitecek" listesine girer
        _t.Clock.Advance(TimeSpan.FromDays(20));
        Assert.Equal(1, (await _svc.GetReportAsync(null, null)).ExpiringSoon);
    }
}
