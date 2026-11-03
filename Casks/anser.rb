cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.36"
  sha256 arm:   "7b1279290419d4849a60c72dccb26ed9f039b5df0de35e7865260a931a4356c3",
         intel: "366f714c366d6258a584162f64a10f8b604eeb0ba7e718e765bf82fab074bf91"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
