cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.31"
  sha256 arm:   "90424dab742f0b97f377f5518889caf33ea0c03a25af5554dcfeda2df653a653",
         intel: "89b20848c4c4442610fc7d124d0181f7e4afe13ed16b7715725ef7b04e94a2c4"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
