cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.42"
  sha256 arm:   "a75c3bb0bebdac8c3d83120227028043a2b4941184f09f9ab9fab06f18b552dc",
         intel: "3bcebf3c930e152d49102399a5ad2c6ffbcdc954bd228e4e17d9c5c00289e459"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
