cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.48"
  sha256 arm:   "f4a1de1d45a3a055100bf288b5e5a96eb05dffd820fdd11824a2af36751aa48b",
         intel: "0ea963d71947ed662a96ecd135e7e934bac23d23f27e089c100de3db75e46622"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
