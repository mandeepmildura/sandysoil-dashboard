const GRAFANA_PUBLIC_URL =
  'https://sandysoils.grafana.net/public-dashboards/87bce5760af943ed943b485b107fe33b'

export default function Monitoring() {
  return (
    <div className="flex-1 flex flex-col bg-[#f9f9f9] overflow-hidden">
      <div className="flex items-center justify-between px-4 md:px-6 py-4">
        <h1 className="font-headline font-bold text-2xl text-[#1a1c1c]">Monitoring</h1>
        <a
          href={GRAFANA_PUBLIC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-body text-[#00639a] hover:underline"
        >
          Open in Grafana
        </a>
      </div>
      <iframe
        src={`${GRAFANA_PUBLIC_URL}?orgId=1&theme=light&kiosk`}
        className="flex-1 w-full border-0"
        title="Farm Monitoring Dashboard"
        allow="fullscreen"
      />
    </div>
  )
}
