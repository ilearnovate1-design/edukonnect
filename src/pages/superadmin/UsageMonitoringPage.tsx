import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Database, 
  TrendingUp, 
  AlertCircle, 
  DollarSign, 
  Users, 
  Building2, 
  ArrowUpRight, 
  ArrowDownRight,
  RefreshCcw,
  Download,
  Settings2,
  Lock,
  ExternalLink,
  ChevronRight,
  Info,
  Activity,
  CreditCard,
  Layers
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { 
  PlatformUsage, 
  SchoolUsageStats, 
  UsagePricing 
} from '../../types';
import { 
  getPlatformUsageHistory, 
  getSchoolsUsageForDate, 
  runUsageAggregation, 
  getPricingSettings,
  savePricingSettings,
  calculateEstimatedCost,
  DEFAULT_PRICING
} from '../../services/usageService';
import { Card, CardBody, CardHeader } from '../../components/common/Card';
import { Modal } from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

export const UsageMonitoringPage: React.FC = () => {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [history, setHistory] = useState<PlatformUsage[]>([]);
  const [schoolUsage, setSchoolUsage] = useState<SchoolUsageStats[]>([]);
  const [pricing, setPricing] = useState<UsagePricing>(DEFAULT_PRICING);
  const [currency, setCurrency] = useState<'USD' | 'NGN'>('NGN');
  
  // Settings Modal
  const [showSettings, setShowSettings] = useState(false);
  const [tempPricing, setTempPricing] = useState<UsagePricing>(DEFAULT_PRICING);

  const fetchData = async () => {
    setLoading(true);
    try {
      const pricingData = await getPricingSettings();
      setPricing(pricingData);
      setTempPricing(pricingData);

      const usageHistory = await getPlatformUsageHistory(30);
      setHistory(usageHistory);

      if (usageHistory.length > 0) {
        const latestDate = usageHistory[usageHistory.length - 1].date;
        const schools = await getSchoolsUsageForDate(latestDate);
        setSchoolUsage(schools);
      }
    } catch (err) {
      console.error('Failed to fetch usage data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchData();
    }
  }, [isSuperAdmin]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await runUsageAggregation();
      await fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSavePricing = async () => {
    try {
      await savePricingSettings(tempPricing);
      setPricing(tempPricing);
      setShowSettings(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportCSV = () => {
    if (history.length === 0) return;
    
    const headers = ['Date', 'Schools', 'Students', 'Users', 'Reads', 'Writes', 'Storage (MB)', 'Est. Cost (USD)'];
    const rows = history.map(h => [
      h.date,
      h.totalSchools,
      h.totalStudents,
      h.totalUsers,
      h.firestoreReads,
      h.firestoreWrites,
      (h.storageBytes / (1024 * 1024)).toFixed(2),
      calculateEstimatedCost(h, pricing).usd.toFixed(4)
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `edukonnect_usage_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <Lock className="w-16 h-16 text-slate-200 mb-4" />
        <h2 className="text-xl font-bold text-slate-900">Platform Access Only</h2>
        <p className="text-slate-500 mt-2 max-w-md">
          This monitoring dashboard is reserved for EduKonnect Platform Administrators.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" text="Loading platform analytics..." />
      </div>
    );
  }

  const latest = history[history.length - 1] || {
    totalSchools: 0,
    totalStudents: 0,
    totalUsers: 0,
    firestoreReads: 0,
    firestoreWrites: 0,
    storageBytes: 0,
    appActivity: { studentsAdded: 0, attendanceRecords: 0, paymentsRecorded: 0, resultsPublished: 0, assignmentsCreated: 0, announcementsPublished: 0 }
  };

  const latestCost = calculateEstimatedCost(latest, pricing);
  const formattedCost = currency === 'USD' 
    ? `$${latestCost.usd.toFixed(2)}` 
    : `₦${latestCost.ngn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CRITICAL': return 'bg-red-100 text-red-700 border-red-200';
      case 'HIGH': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'WATCH': return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Usage & Cost Monitoring</h1>
          <p className="text-slate-500 text-sm flex items-center gap-2">
            Monitor EduKonnect platform usage, school activity and infrastructure costs.
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">PLATFORM ADMIN</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrency(currency === 'USD' ? 'NGN' : 'USD')}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            {currency}
          </button>
          <button
            onClick={handleExportCSV}
            className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            title="Export CSV"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            title="Pricing Settings"
          >
            <Settings2 className="w-5 h-5" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCcw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Aggregating...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardBody className="p-5">
            <div className="flex justify-between items-start">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                <Building2 className="w-5 h-5" />
              </div>
              <span className="flex items-center text-xs font-medium text-emerald-600">
                <ArrowUpRight className="w-3 h-3 mr-0.5" />
                +1
              </span>
            </div>
            <div className="mt-3">
              <p className="text-sm font-medium text-slate-500">Total Schools</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{latest.totalSchools}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-5">
            <div className="flex justify-between items-start">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <Users className="w-5 h-5" />
              </div>
              <span className="flex items-center text-xs font-medium text-emerald-600">
                <ArrowUpRight className="w-3 h-3 mr-0.5" />
                12%
              </span>
            </div>
            <div className="mt-3">
              <p className="text-sm font-medium text-slate-500">Total Students</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{latest.totalStudents}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-5">
            <div className="flex justify-between items-start">
              <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                <Database className="w-5 h-5" />
              </div>
              <span className="flex items-center text-xs font-medium text-slate-400">
                Today
              </span>
            </div>
            <div className="mt-3">
              <p className="text-sm font-medium text-slate-500">Firestore Reads</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {latest.firestoreReads > 0 ? latest.firestoreReads.toLocaleString() : '---'}
              </p>
              <p className="text-[10px] text-slate-400 mt-1 font-mono">Source: Google Cloud Billing (Not Connected)</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-5">
            <div className="flex justify-between items-start">
              <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
                <DollarSign className="w-5 h-5" />
              </div>
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">
                ESTIMATE
              </span>
            </div>
            <div className="mt-3">
              <p className="text-sm font-medium text-slate-500">Infrastructure Cost</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{formattedCost}</p>
              <p className="text-[10px] text-slate-400 mt-1">Based on pricing assumptions</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Trends */}
        <div className="lg:col-span-2 space-y-6">
          {/* Trend Chart */}
          <Card>
            <CardHeader className="p-5 flex items-center justify-between border-b border-slate-50">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900">Usage Trends</h3>
              </div>
              <div className="text-xs text-slate-400">Last 30 Days</div>
            </CardHeader>
            <CardBody className="p-5">
              {history.length < 2 ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                  <BarChart3 className="w-12 h-12 mb-2 opacity-20" />
                  <p>Not enough data yet.</p>
                  <p className="text-xs mt-1 text-center max-w-[200px]">Data is collected daily during platform aggregation.</p>
                </div>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="colorStudents" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#94a3b8" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(val) => val.split('-').slice(1).join('/')}
                      />
                      <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="totalStudents" 
                        name="Total Students"
                        stroke="#10b981" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorStudents)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>

          {/* School Usage Table */}
          <Card>
            <CardHeader className="p-5 flex items-center justify-between border-b border-slate-50">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900">School Usage Breakdown</h3>
              </div>
              <button className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1">
                View all <ChevronRight className="w-3 h-3" />
              </button>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">School</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Students</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Reads</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Writes</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Est. Cost</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {schoolUsage.length > 0 ? (
                    schoolUsage.map((s) => (
                      <tr key={s.schoolId} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-slate-900">{s.schoolName}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{s.schoolId}</p>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">{s.students}</td>
                        <td className="px-6 py-4 text-sm text-slate-600 text-right">{s.reads > 0 ? s.reads.toLocaleString() : '---'}</td>
                        <td className="px-6 py-4 text-sm text-slate-600 text-right">{s.writes > 0 ? s.writes.toLocaleString() : '---'}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-900 text-right">
                          {currency === 'USD' ? `$${s.estimatedCost.toFixed(3)}` : `₦${(s.estimatedCost * pricing.exchangeRate).toFixed(2)}`}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusColor(s.status)}`}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-400 text-sm">
                        No school breakdown available. Run aggregation to update.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right Column: Quotas & Alerts */}
        <div className="space-y-6">
          {/* Quota Monitoring */}
          <Card>
            <CardHeader className="p-5 border-b border-slate-50">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-600" />
                Free Quota Monitoring
              </h3>
            </CardHeader>
            <CardBody className="p-5 space-y-6">
              {/* Reads Quota */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-600">Firestore Reads</span>
                  <span className="text-slate-900 font-bold">
                    {latest.firestoreReads > 0 ? ((latest.firestoreReads / 50000) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      (latest.firestoreReads / 50000) > 0.9 ? 'bg-red-500' : 
                      (latest.firestoreReads / 50000) > 0.75 ? 'bg-orange-500' : 
                      (latest.firestoreReads / 50000) > 0.5 ? 'bg-blue-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, (latest.firestoreReads / 50000) * 100)}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{latest.firestoreReads.toLocaleString()} / 50,000</span>
                  <span className={`font-bold ${
                    (latest.firestoreReads / 50000) > 0.9 ? 'text-red-600' : 
                    (latest.firestoreReads / 50000) > 0.75 ? 'text-orange-600' : 'text-emerald-600'
                  }`}>
                    {(latest.firestoreReads / 50000) > 0.9 ? 'CRITICAL' : 
                     (latest.firestoreReads / 50000) > 0.75 ? 'HIGH' : 
                     (latest.firestoreReads / 50000) > 0.5 ? 'WATCH' : 'HEALTHY'}
                  </span>
                </div>
              </div>

              {/* Writes Quota */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-600">Firestore Writes</span>
                  <span className="text-slate-900 font-bold">
                    {latest.firestoreWrites > 0 ? ((latest.firestoreWrites / 20000) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      (latest.firestoreWrites / 20000) > 0.9 ? 'bg-red-500' : 
                      (latest.firestoreWrites / 20000) > 0.75 ? 'bg-orange-500' : 
                      (latest.firestoreWrites / 20000) > 0.5 ? 'bg-blue-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, (latest.firestoreWrites / 20000) * 100)}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{latest.firestoreWrites.toLocaleString()} / 20,000</span>
                  <span className={`font-bold ${
                    (latest.firestoreWrites / 20000) > 0.9 ? 'text-red-600' : 
                    (latest.firestoreWrites / 20000) > 0.75 ? 'text-orange-600' : 'text-emerald-600'
                  }`}>
                    {(latest.firestoreWrites / 20000) > 0.9 ? 'CRITICAL' : 
                     (latest.firestoreWrites / 20000) > 0.75 ? 'HIGH' : 
                     (latest.firestoreWrites / 20000) > 0.5 ? 'WATCH' : 'HEALTHY'}
                  </span>
                </div>
              </div>

              {/* Storage Quota */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-600">Storage Used</span>
                  <span className="text-slate-900 font-bold">
                    {latest.storageBytes > 0 ? ((latest.storageBytes / (1024 * 1024 * 1024)) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      (latest.storageBytes / (1024 * 1024 * 1024)) > 0.9 ? 'bg-red-500' : 
                      (latest.storageBytes / (1024 * 1024 * 1024)) > 0.75 ? 'bg-orange-500' : 
                      (latest.storageBytes / (1024 * 1024 * 1024)) > 0.5 ? 'bg-blue-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, (latest.storageBytes / (1024 * 1024 * 1024)) * 100)}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{(latest.storageBytes / (1024 * 1024 * 1024)).toFixed(2)} GB / 1.0 GB</span>
                  <span className={`font-bold ${
                    (latest.storageBytes / (1024 * 1024 * 1024)) > 0.9 ? 'text-red-600' : 
                    (latest.storageBytes / (1024 * 1024 * 1024)) > 0.75 ? 'text-orange-600' : 'text-emerald-600'
                  }`}>
                    {(latest.storageBytes / (1024 * 1024 * 1024)) > 0.9 ? 'CRITICAL' : 
                     (latest.storageBytes / (1024 * 1024 * 1024)) > 0.75 ? 'HIGH' : 
                     (latest.storageBytes / (1024 * 1024 * 1024)) > 0.5 ? 'WATCH' : 'HEALTHY'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex gap-2">
                <Info className="w-4 h-4 text-slate-400 shrink-0" />
                <p className="text-[10px] text-slate-500 leading-tight">
                  Thresholds: 0-50% (Healthy), 50-75% (Watch), 75-90% (High), 90%+ (Critical). 
                  Internal monitoring only.
                </p>
              </div>
            </CardBody>
          </Card>

          {/* Billing Status */}
          <Card className="bg-slate-900 text-white">
            <CardBody className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-white/10 text-white">
                  <CreditCard className="w-5 h-5" />
                </div>
                <h3 className="font-bold">Actual Billing</h3>
              </div>
              
              <div className="space-y-4">
                <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
                    <AlertCircle className="w-3 h-3" />
                    Connection Status
                  </div>
                  <p className="text-sm font-bold text-red-400">Billing API not connected</p>
                </div>

                <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Connecting your Google Cloud Billing account will allow actual cost monitoring instead of estimates.
                  </p>
                  <button className="mt-3 w-full py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2">
                    <ExternalLink className="w-3 h-3" />
                    Configure API
                  </button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Alerts */}
          <Card>
            <CardHeader className="p-5 border-b border-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">System Alerts</h3>
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">2 ACTIVE</span>
            </CardHeader>
            <CardBody className="p-5 space-y-3">
              <div className="flex gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold text-blue-900">Billing data unavailable</p>
                  <p className="text-blue-700 mt-0.5">Actual infrastructure costs are being estimated.</p>
                </div>
              </div>
              
              <div className="flex gap-3 p-3 bg-orange-50 border border-orange-100 rounded-lg">
                <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold text-orange-900">Unusual activity detected</p>
                  <p className="text-orange-700 mt-0.5">School B generated 2x more reads than average today.</p>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Pricing Settings Modal */}
      <Modal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="Infrastructure Pricing Assumptions"
      >
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex gap-3">
            <Info className="w-5 h-5 text-blue-600 shrink-0" />
            <p className="text-xs text-blue-700">
              Update these values to match your current Firebase region pricing. 
              Estimates are calculated using these assumptions.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reads / Million ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={tempPricing.firestoreReadPerMillion}
                onChange={(e) => setTempPricing({...tempPricing, firestoreReadPerMillion: parseFloat(e.target.value)})}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Writes / Million ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={tempPricing.firestoreWritePerMillion}
                onChange={(e) => setTempPricing({...tempPricing, firestoreWritePerMillion: parseFloat(e.target.value)})}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Storage / GB ($)</label>
              <input 
                type="number" 
                step="0.01"
                value={tempPricing.storagePerGB}
                onChange={(e) => setTempPricing({...tempPricing, storagePerGB: parseFloat(e.target.value)})}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">USD → NGN Rate</label>
              <input 
                type="number" 
                step="10"
                value={tempPricing.exchangeRate}
                onChange={(e) => setTempPricing({...tempPricing, exchangeRate: parseFloat(e.target.value)})}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/20 font-bold"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setShowSettings(false)}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSavePricing}
              className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
