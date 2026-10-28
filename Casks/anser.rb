cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.35"
  sha256 arm:   "ca9e4e81d9c76de6b43a854bafc38eb4e39ea3116baef7e0eae951da00d2ea3c",
         intel: "7a9ee121aa2fa366796e5072aa944652744db2f645824fb9990b36c2020601b4"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
