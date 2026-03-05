import SwiftUI

@main
struct OpenClawSetupApp: App {
  var body: some Scene {
    WindowGroup {
      InstallerDashboardView()
    }
  }
}

struct InstallerDashboardView: View {
  @State private var telegramToken: String = ""
  @State private var allowedChatIds: String = ""
  @State private var installLog: String = "Ready to install OpenClaw creator stack."

  var body: some View {
    ZStack {
      LinearGradient(colors: [Color(red: 0.06, green: 0.09, blue: 0.16), Color(red: 0.09, green: 0.16, blue: 0.27)],
                     startPoint: .topLeading,
                     endPoint: .bottomTrailing)
        .ignoresSafeArea()

      VStack(alignment: .leading, spacing: 16) {
        Text("OpenClaw Creator Installer")
          .font(.system(size: 34, weight: .bold))
          .foregroundColor(.white)

        Text("Set up OpenClaw + Telegram + content workflows")
          .foregroundColor(.white.opacity(0.78))

        Group {
          TextField("Telegram bot token", text: $telegramToken)
          TextField("Allowed chat IDs (comma-separated)", text: $allowedChatIds)
        }
        .textFieldStyle(.roundedBorder)

        HStack {
          Button("Run Installer") {
            installLog = "Run scripts/install-openclaw-macos.sh from generated creator package."
          }
          Button("Open Creator Studio") {
            if let url = URL(string: "http://127.0.0.1:4051/openclaw-creator-studio") {
              NSWorkspace.shared.open(url)
            }
          }
          .buttonStyle(.bordered)
        }

        Text(installLog)
          .font(.system(.body, design: .monospaced))
          .foregroundColor(.white.opacity(0.85))
          .padding()
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color.white.opacity(0.08))
          .cornerRadius(12)

        Spacer()
      }
      .padding(24)
    }
  }
}
