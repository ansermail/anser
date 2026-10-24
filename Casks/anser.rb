cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.27"
  sha256 arm:   "13568404677719946890ca807199c902019d3a84f2be753344318faba69ab580",
         intel: "1967eb59ba57658daac6be0bcf5b7efb9b04af1e09907c0f3ecc48eae60a39f2"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
