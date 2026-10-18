cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.21"
  sha256 arm:   "2f00c8c0fe241e316404ac210a525700d5a18f5b823b800802c9d155bbfc0c32",
         intel: "fff13d868e465d10b11f06a8234c871e571553416f344827934cc77c4dbac471"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
