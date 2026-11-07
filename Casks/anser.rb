cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.39"
  sha256 arm:   "2796479fd78959caa49444ed581eded89f05af7991a82c1ca70614deb5bab6ad",
         intel: "9d4755546fce2b65af37c3d4aec964a3ada757d3f9251f178867dd4868bd07d7"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
