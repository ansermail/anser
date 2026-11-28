cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.49"
  sha256 arm:   "f587a007b0b4e8ea596544dd922e5638a50889a599b2654845da862ae07817fb",
         intel: "08f195a50796f8709ecb70321737c8d53d4150a87f4cecedb683fc4d65e1b609"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
