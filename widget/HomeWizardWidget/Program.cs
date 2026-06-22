// HomeWizard Widget provider — COM server entry point.
// Launched by the Widgets host with "-RegisterProcessAsComServer".
using System.Runtime.InteropServices;
using Microsoft.Windows.Widgets.Providers;

namespace HomeWizardWidget;

public static class Program
{
    [DllImport("kernel32.dll")]
    static extern IntPtr GetConsoleWindow();

    [DllImport("ole32.dll")]
    static extern int CoRegisterClassObject(
        [MarshalAs(UnmanagedType.LPStruct)] Guid rclsid,
        [MarshalAs(UnmanagedType.IUnknown)] object pUnk,
        uint dwClsContext, uint flags, out uint lpdwRegister);

    [DllImport("ole32.dll")]
    static extern int CoRevokeClassObject(uint dwRegister);

    [MTAThread]
    static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "-RegisterProcessAsComServer")
        {
            WinRT.ComWrappersSupport.InitializeComWrappers();
            CoRegisterClassObject(
                typeof(WidgetProvider).GUID,
                new WidgetProviderFactory<WidgetProvider>(),
                /* CLSCTX_LOCAL_SERVER */ 0x4,
                /* REGCLS_MULTIPLEUSE */ 0x1,
                out uint cookie);

            if (GetConsoleWindow() != IntPtr.Zero)
            {
                Console.WriteLine("HomeWizard widget provider registered. Press ENTER to exit.");
                Console.ReadLine();
            }
            else
            {
                using var emptyEvent = WidgetProvider.GetEmptyWidgetListEvent();
                emptyEvent.WaitOne();
            }
            CoRevokeClassObject(cookie);
        }
    }
}

// --- IClassFactory plumbing ---
file static class ComGuids
{
    public const string IClassFactory = "00000001-0000-0000-C000-000000000046";
    public const string IUnknown = "00000000-0000-0000-C000-000000000046";
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid(ComGuids.IClassFactory)]
file interface IClassFactory
{
    [PreserveSig] int CreateInstance(IntPtr pUnkOuter, ref Guid riid, out IntPtr ppvObject);
    [PreserveSig] int LockServer(bool fLock);
}

file class WidgetProviderFactory<T> : IClassFactory where T : IWidgetProvider, new()
{
    private const int E_NOINTERFACE = unchecked((int)0x80004002);
    private const int CLASS_E_NOAGGREGATION = unchecked((int)0x80040110);

    public int CreateInstance(IntPtr pUnkOuter, ref Guid riid, out IntPtr ppvObject)
    {
        ppvObject = IntPtr.Zero;
        if (pUnkOuter != IntPtr.Zero) Marshal.ThrowExceptionForHR(CLASS_E_NOAGGREGATION);

        if (riid == typeof(T).GUID || riid == Guid.Parse(ComGuids.IUnknown))
            ppvObject = WinRT.MarshalInspectable<IWidgetProvider>.FromManaged(new T());
        else
            return E_NOINTERFACE;
        return 0;
    }

    public int LockServer(bool fLock) => 0;
}
