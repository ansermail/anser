cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.24"
  sha256 arm:   "cac8f6124eb200be31a1771e0a23696b7b828c3e6d80c83bec7019afa983430c",
         intel: "f20fe4b03b44aad99f5a2ae54529d0ea7d069e1744ceb2b46bb87e71187de6b1"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
