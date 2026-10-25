cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.29"
  sha256 arm:   "8c0b95782a430783cfccec011347f359d2bf9539e50e1c4c16c7b586826a78fa",
         intel: "f3bec13779b3e7245a5afbc5ee0b038863cb5dd7b4425e9e5b9c8e72f236603b"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
